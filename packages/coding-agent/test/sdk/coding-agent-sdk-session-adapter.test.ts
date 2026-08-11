import type { AgentMessage, ThinkingLevel } from "@vetta/agent-core";
import type { Api, Model } from "@vetta/ai";
import type {
	PromptRequest,
	RuntimeExecutionObservationEvent,
	RuntimeSessionExecutionObservation,
	RuntimeSessionState,
} from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import type {
	CodingAgentSdkSessionCapabilityPort,
	CodingAgentSdkSessionRuntimePort,
} from "../../src/host/sdk-session/runtime-contracts.js";
import { CodingAgentSdkSessionAdapter } from "../../src/host/sdk-session/session-adapter.js";
import type { CodingAgentRetryEvent } from "../../src/public-api/sdk/sdk-event-contract.js";

describe("Coding Agent SDK session adapter", () => {
	it("maps prompt, queue, model and thinking controls onto the narrow Runtime port", async () => {
		const runtime = new FakeSdkRuntime();
		const session = new CodingAgentSdkSessionAdapter(runtime);
		const image = { type: "image" as const, data: "image-data", mimeType: "image/png" };

		await session.prompt("first", { images: [image], metadata: { source: "sdk" } });
		await session.steer("steer", [image]);
		await session.followUp("follow-up");
		await session.setModel({ provider: "openai", id: "model-id" } as Model<Api>);
		session.setThinkingLevel("high");
		session.reconfigureCustomTools(undefined);

		expect(runtime.prompts).toEqual([
			{ text: "first", images: [image], metadata: { source: "sdk" } },
			{ text: "steer", images: [image], streamingBehavior: "steer" },
			{ text: "follow-up", streamingBehavior: "followUp" },
		]);
		expect(runtime.selectedModelKeys).toEqual(["openai/model-id"]);
		expect(runtime.thinkingLevels).toEqual(["high"]);
		expect(runtime.customToolReconfigurations).toEqual([undefined]);
		expect(session.sessionId).toBe("sdk-session");
		expect(session.sessionFile).toBe("C:/sessions/sdk-session.jsonl");
		expect(session.isStreaming).toBe(false);
	});

	it("forwards fixed-session subagent observation and control without exposing the coordinator", () => {
		const runtime = new FakeSdkRuntime();
		const session = new CodingAgentSdkSessionAdapter(runtime);

		expect(session.listSubagents()).toEqual([expect.objectContaining({ id: "child-1", status: "running" })]);
		expect(session.interruptSubagent("child-1")).toMatchObject({ id: "child-1", status: "interrupted" });
		expect(session.clearFinishedSubagents()).toBe(1);
		expect(runtime.interruptedSubagents).toEqual(["child-1"]);
		expect(runtime.clearFinishedSubagentCalls).toBe(1);
		expect(Reflect.has(session, "subagents")).toBe(false);
	});

	it("exposes product behavior through narrow views and asynchronous commands", async () => {
		const runtime = new FakeSdkRuntime();
		const session = new CodingAgentSdkSessionAdapter(runtime);

		expect(await session.listAvailableModels()).toEqual([]);
		expect(session.getSystemPrompt()).toBe("effective prompt");
		expect(session.getPromptTemplates()).toEqual([
			expect.objectContaining({ name: "review", content: "Review this" }),
		]);
		expect(session.getMemoryConfiguration()).toEqual({ enabled: true, file: "MEMORY.md", charLimit: 4_000 });
		await expect(session.flushMemory()).resolves.toBe(2);
		await session.reconfigureAgentPlugins(undefined);
		await session.reloadMcp();
		await session.reload();
		await expect(session.exportToHtml("session.html")).resolves.toBe("session.html");
		expect(session.hasExtensionHandlers("before_agent_start")).toBe(true);
		expect(runtime.productCommands).toEqual(["flush-memory", "plugins", "reload-mcp", "reload", "export"]);
		for (const concrete of ["modelRegistry", "backgroundTasks", "todoStore", "resourceLoader", "extensionRunner"]) {
			expect(Reflect.has(session, concrete)).toBe(false);
		}
	});

	it("projects complete execution observations onto existing Agent events", () => {
		const runtime = new FakeSdkRuntime();
		const session = new CodingAgentSdkSessionAdapter(runtime);
		const eventTypes: string[] = [];
		session.subscribe((event) => eventTypes.push(event.type));

		runtime.emit({ type: "agent.start" });
		runtime.emit({ type: "turn.start" });
		runtime.emit({
			type: "tool.execution.start",
			toolCallId: "call-1",
			toolName: "read",
			args: { path: "README.md" },
			startedAt: 1,
		});
		runtime.emit({ type: "agent.end", messages: [] });
		runtime.emitRetry({
			type: "auto_retry_start",
			attempt: 1,
			maxAttempts: 3,
			delayMs: 10,
			errorMessage: "rate limited",
		});

		expect(eventTypes).toEqual([
			"agent_start",
			"turn_start",
			"tool_execution_start",
			"agent_end",
			"auto_retry_start",
		]);
	});

	it("isolates listeners and closes Runtime ownership exactly once", async () => {
		const runtime = new FakeSdkRuntime();
		const session = new CodingAgentSdkSessionAdapter(runtime);
		const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const observed: string[] = [];
		session.subscribe(() => {
			throw new Error("listener failed");
		});
		session.subscribe((event) => observed.push(event.type));

		runtime.emit({ type: "agent.start" });
		expect(observed).toEqual(["agent_start"]);
		expect(warning).toHaveBeenCalledOnce();

		await Promise.all([session.close(), session.close()]);
		expect(runtime.disposeCalls).toBe(1);
		expect(runtime.observers.size).toBe(0);
		await expect(session.prompt("closed")).rejects.toThrow("AgentSession is closed");
		warning.mockRestore();
	});

	it("keeps the session closed while allowing failed cleanup to be retried", async () => {
		const runtime = new FakeSdkRuntime();
		runtime.disposeFailures = 1;
		const onClosed = vi.fn();
		const session = new CodingAgentSdkSessionAdapter(runtime, onClosed);

		await expect(session.close()).rejects.toThrow("runtime cleanup failed");
		expect(onClosed).not.toHaveBeenCalled();
		await expect(session.prompt("closed")).rejects.toThrow("AgentSession is closed");
		await expect(session.close()).resolves.toBeUndefined();
		expect(runtime.disposeCalls).toBe(2);
		expect(onClosed).toHaveBeenCalledOnce();
	});
});

class FakeSdkRuntime implements CodingAgentSdkSessionRuntimePort {
	readonly sessionId = "sdk-session";
	readonly sessionPath = "C:/sessions/sdk-session.jsonl";
	readonly prompts: PromptRequest[] = [];
	readonly selectedModelKeys: string[] = [];
	readonly thinkingLevels: ThinkingLevel[] = [];
	readonly customToolReconfigurations: Array<readonly unknown[] | undefined> = [];
	readonly observers = new Set<(observation: RuntimeSessionExecutionObservation) => Promise<void> | void>();
	readonly retryObservers = new Set<(event: CodingAgentRetryEvent) => void>();
	readonly interruptedSubagents: string[] = [];
	readonly productCommands: string[] = [];
	clearFinishedSubagentCalls = 0;
	disposeCalls = 0;
	disposeFailures = 0;
	readonly capabilities: CodingAgentSdkSessionCapabilityPort = {
		prompt: async () => undefined,
		selectModel: async () => undefined,
		setThinkingLevel: () => undefined,
		subscribeRetryEvents: (handler) => {
			this.retryObservers.add(handler);
			return () => this.retryObservers.delete(handler);
		},
		readRetryAttempt: () => 0,
		readActiveToolNames: () => [],
		readAllTools: () => [],
		setActiveToolNames: () => undefined,
		reconfigureCustomTools: (customTools) => this.customToolReconfigurations.push(customTools),
		readAgentMode: () => undefined,
		setAgentMode: () => undefined,
		readIsCompacting: () => false,
		readSteeringMode: () => "one-at-a-time",
		readFollowUpMode: () => "one-at-a-time",
		readSessionName: () => undefined,
		readScopedModels: () => [],
		setScopedModels: () => undefined,
		clearQueue: () => ({ steering: [], followUp: [] }),
		readPendingMessageCount: () => 0,
		readSteeringMessages: () => [],
		readFollowUpMessages: () => [],
		cycleModel: async () => undefined,
		cycleThinkingLevel: () => undefined,
		readAvailableThinkingLevels: () => ["off"],
		supportsXhighThinking: () => false,
		supportsThinking: () => false,
		setSteeringMode: () => undefined,
		setFollowUpMode: () => undefined,
		compact: async () => ({ summary: "", firstKeptEntryId: "", tokensBefore: 0 }),
		abortCompaction: () => undefined,
		setAutoCompactionEnabled: () => undefined,
		readAutoCompactionEnabled: () => true,
		abortRetry: () => undefined,
		readIsRetrying: () => false,
		readAutoRetryEnabled: () => true,
		setAutoRetryEnabled: () => undefined,
		setSessionName: async () => undefined,
		readSessionStats: () => ({
			sessionFile: undefined,
			sessionId: "sdk-session",
			userMessages: 0,
			assistantMessages: 0,
			toolCalls: 0,
			toolResults: 0,
			totalMessages: 0,
			tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			cost: 0,
		}),
		readContextUsage: () => undefined,
		readLastAssistantText: () => undefined,
		readSubagents: () => [subagent("running")],
		interruptSubagent: (target) => {
			this.interruptedSubagents.push(target);
			return subagent("interrupted");
		},
		clearFinishedSubagents: () => {
			this.clearFinishedSubagentCalls += 1;
			return 1;
		},
		readAvailableModels: async () => [],
		readSystemPrompt: () => "effective prompt",
		readSkills: () => [],
		readPromptTemplates: () => [
			{
				name: "review",
				description: "Review",
				content: "Review this",
				source: "test",
				filePath: "review.md",
			},
		],
		reconfigureAgentPlugins: async () => {
			this.productCommands.push("plugins");
		},
		readBackgroundTasks: () => [],
		killBackgroundTask: () => false,
		clearFinishedBackgroundTasks: () => 0,
		readTodos: () => [],
		clearTodos: () => false,
		readMemoryConfiguration: () => ({ enabled: true, file: "MEMORY.md", charLimit: 4_000 }),
		flushMemory: async () => {
			this.productCommands.push("flush-memory");
			return 2;
		},
		reloadMcp: async () => {
			this.productCommands.push("reload-mcp");
		},
		reload: async () => {
			this.productCommands.push("reload");
		},
		exportToHtml: async (outputPath) => {
			this.productCommands.push("export");
			return outputPath ?? "session.html";
		},
		hasExtensionHandlers: (eventType) => eventType === "before_agent_start",
	};
	private readonly runtimeState: RuntimeSessionState = {
		model: undefined,
		thinkingLevel: "medium",
		isStreaming: false,
		messageCount: 0,
		contextPercent: null,
		contextWindow: 0,
		activeToolNames: [],
	};

	async prompt(request: PromptRequest): Promise<void> {
		this.prompts.push(request);
	}

	async abort(): Promise<void> {}

	readState(): RuntimeSessionState {
		return this.runtimeState;
	}

	readMessages(): readonly AgentMessage[] {
		return [];
	}

	async selectModel(modelKey: string): Promise<void> {
		this.selectedModelKeys.push(modelKey);
	}

	setThinkingLevel(level: ThinkingLevel): void {
		this.thinkingLevels.push(level);
	}

	subscribeExecutionObservation(
		handler: (observation: RuntimeSessionExecutionObservation) => Promise<void> | void,
	): () => void {
		this.observers.add(handler);
		return () => this.observers.delete(handler);
	}

	async dispose(): Promise<void> {
		this.disposeCalls++;
		if (this.disposeFailures > 0) {
			this.disposeFailures--;
			throw new Error("runtime cleanup failed");
		}
	}

	emit(event: RuntimeExecutionObservationEvent): void {
		for (const observer of this.observers) {
			void observer({ turnId: "turn-1", event, timestamp: 1 });
		}
	}

	emitRetry(event: CodingAgentRetryEvent): void {
		for (const observer of this.retryObservers) observer(event);
	}
}

function subagent(status: "running" | "interrupted") {
	return {
		id: "child-1",
		taskName: "child_one",
		path: "/root/child_one",
		agentType: "explorer",
		status,
		task: "Inspect",
		parentSessionId: "sdk-session",
		startedAt: 1,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costTotal: 0 },
		generation: status === "running" ? 0 : 1,
	};
}
