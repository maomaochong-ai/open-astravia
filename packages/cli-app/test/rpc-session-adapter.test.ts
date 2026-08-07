import { join } from "node:path";
import type { CodingAgentRuntimeComposition } from "@vetta/coding-agent/composition";
import type { RpcSessionInitialization, RpcSessionState } from "@vetta/coding-agent/rpc";
import type { GreenfieldRuntimeSession, GreenfieldRuntimeSessionCoreAssembly, SessionEvent } from "@vetta/runtime-core";
import { resolveSessionIdFromPath } from "@vetta/runtime-storage/conversation";
import type { CodingToolRegistration } from "@vetta/runtime-tools/coding";
import { describe, expect, test, vi } from "vitest";
import { type CreateImRpcSessionAdapterOptions, createImRpcSessionAdapter } from "../src/rpc/rpc-session-adapter.js";
import { RpcSessionEventAdapter } from "../src/rpc/rpc-session-event-adapter.js";

describe("IM RPC session adapter", () => {
	test("projects current identity asynchronously and follows rollover for state and memory flush", async () => {
		const fixture = createAdapterFixture();
		const stateCapability = required(fixture.adapter.state);
		const memoryCapability = required(fixture.adapter.memory);

		await expect(stateCapability.readState()).resolves.toMatchObject({
			sessionId: "session-1",
			sessionFile: "session-1.conversation.jsonl",
			steeringMode: "all",
			followUpMode: "one-at-a-time",
			isCompacting: true,
			autoCompactionEnabled: true,
			pendingMessageCount: 2,
		} satisfies Partial<RpcSessionState>);

		fixture.setIdentity("session-2", "session-2.conversation.jsonl");
		await expect(stateCapability.readState()).resolves.toMatchObject({
			sessionId: "session-2",
			sessionFile: "session-2.conversation.jsonl",
		});
		await expect(memoryCapability.flushMemory()).resolves.toBe(4);
		expect(fixture.flushMemory).toHaveBeenLastCalledWith("session-2");
	});

	test("registers the existing IM attachment tool and releases all owned resources once", async () => {
		const fixture = createAdapterFixture();
		await fixture.adapter.initialize(createInitialization());

		expect(fixture.register).toHaveBeenCalledOnce();
		expect(fixture.register.mock.calls[0]?.[0]).toMatchObject({
			tool: { name: "im_send_attachment" },
			scopeUse: ["im-claw"],
			category: "im",
		});

		await fixture.adapter.dispose();
		await fixture.adapter.dispose();
		expect(fixture.unregister).toHaveBeenCalledOnce();
		expect(fixture.unregister).toHaveBeenCalledWith("im_send_attachment");
		expect(fixture.disposeSession).toHaveBeenCalledOnce();
		expect(fixture.disposeRuntime).toHaveBeenCalledOnce();
	});

	test("keeps RPC admission closed and retries only failed owned resources", async () => {
		const fixture = createAdapterFixture();
		await fixture.adapter.initialize(createInitialization());
		fixture.disposeSession.mockRejectedValueOnce(new Error("session cleanup failed"));

		const first = fixture.adapter.dispose();
		const concurrent = fixture.adapter.dispose();
		await expect(first).rejects.toThrow("Failed to dispose IM RPC resources");
		await expect(concurrent).rejects.toThrow("Failed to dispose IM RPC resources");
		expect(fixture.unregister).toHaveBeenCalledOnce();
		expect(fixture.disposeRuntime).toHaveBeenCalledOnce();

		await expect(fixture.adapter.dispose()).resolves.toBeUndefined();
		expect(fixture.disposeSession).toHaveBeenCalledTimes(2);
		expect(fixture.unregister).toHaveBeenCalledOnce();
		expect(fixture.disposeRuntime).toHaveBeenCalledOnce();
	});

	test("fails closed when the required host bridge is absent", async () => {
		const fixture = createAdapterFixture();
		const initialization = createInitialization();

		await expect(fixture.adapter.initialize({ ...initialization, hostBridge: undefined })).rejects.toThrow(
			"requires a host bridge",
		);
		expect(fixture.register).not.toHaveBeenCalled();
	});

	test("fails closed when the runtime tool activation scenario is not IM", () => {
		expect(() => createAdapterFixture("cli")).toThrow("requires runtime scenario im-claw, received cli");
	});

	test("delegates session transitions through the active session host", async () => {
		const fixture = createAdapterFixture();
		const sessionCapability = required(fixture.adapter.session);

		await expect(sessionCapability.newSession("parent.conversation.jsonl")).resolves.toBe(true);
		await expect(sessionCapability.switchSession("next.conversation.jsonl")).resolves.toBe(true);
		await expect(sessionCapability.fork("entry-1")).resolves.toEqual({ text: "fork prompt", cancelled: false });

		expect(fixture.newSession).toHaveBeenCalledWith({ parentSession: "parent.conversation.jsonl" });
		expect(fixture.switchSession).toHaveBeenCalledWith("next.conversation.jsonl");
		expect(fixture.fork).toHaveBeenCalledWith("entry-1");
	});

	test("keeps RPC success, state and the next prompt on the committed target", async () => {
		const fixture = createAdapterFixture();
		fixture.switchSession.mockImplementationOnce(async () => {
			fixture.setIdentity("session-2", "session-2.conversation.jsonl");
			return { cancelled: false };
		});

		await expect(required(fixture.adapter.session).switchSession("session-2.conversation.jsonl")).resolves.toBe(true);
		await expect(required(fixture.adapter.state).readState()).resolves.toMatchObject({
			sessionId: "session-2",
			sessionFile: "session-2.conversation.jsonl",
		});
		await expect(required(fixture.adapter.turn).prompt("after cleanup", { source: "rpc" })).resolves.toBeUndefined();
		expect(fixture.prompt).toHaveBeenLastCalledWith("session-2", {
			text: "after cleanup",
			images: undefined,
			streamingBehavior: undefined,
		});
	});

	test("delivers agent_end only after the active turn command has settled", async () => {
		const fixture = createAdapterFixture();
		const frames: unknown[] = [];
		fixture.adapter.subscribe((frame) => frames.push(frame));
		let finishPrompt: (() => void) | undefined;
		fixture.prompt.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishPrompt = () => resolve({ kind: "started" });
					fixture.emit(sessionEvent({ type: "session.lifecycle", phase: "agent_end" }));
				}),
		);

		const prompt = required(fixture.adapter.turn).prompt("hello", { source: "rpc" });
		await Promise.resolve();
		expect(frames).toEqual([]);

		finishPrompt?.();
		await prompt;
		expect(frames).toEqual([{ type: "agent_end" }]);
	});

	test("reports a failed turn result when no terminal event was emitted", async () => {
		const fixture = createAdapterFixture();
		fixture.prompt.mockResolvedValueOnce({ status: "failed", error: { message: "turn setup failed" } });

		await expect(required(fixture.adapter.turn).prompt("hello", { source: "rpc" })).rejects.toThrow(
			"turn setup failed",
		);
	});

	test("uses agent_end as the sole outcome when a failed result already emitted the terminal event", async () => {
		const fixture = createAdapterFixture();
		const frames: unknown[] = [];
		fixture.adapter.subscribe((frame) => frames.push(frame));
		fixture.prompt.mockImplementationOnce(async () => {
			fixture.emit(sessionEvent({ type: "session.lifecycle", phase: "agent_end" }));
			return { status: "failed", error: { message: "Provider stream failed" } };
		});

		await expect(required(fixture.adapter.turn).prompt("hello", { source: "rpc" })).resolves.toBeUndefined();
		expect(frames).toEqual([{ type: "agent_end" }]);
	});

	test("uses agent_end as the sole outcome when the turn command throws after the terminal event", async () => {
		const fixture = createAdapterFixture();
		const frames: unknown[] = [];
		fixture.adapter.subscribe((frame) => frames.push(frame));
		fixture.prompt.mockImplementationOnce(async () => {
			fixture.emit(sessionEvent({ type: "session.lifecycle", phase: "agent_end" }));
			throw new Error("late turn rejection");
		});

		await expect(required(fixture.adapter.turn).prompt("hello", { source: "rpc" })).resolves.toBeUndefined();
		expect(frames).toEqual([{ type: "agent_end" }]);
	});

	test("discovers prompt and skill commands without enabling Extension command cutover", () => {
		const fixture = createAdapterFixture();

		expect(required(fixture.adapter.commands).readCommands()).toEqual([
			{
				name: "review",
				description: "Review changes",
				source: "prompt",
				location: "project",
				path: "prompts/review.md",
			},
			{
				name: "skill:deploy",
				description: "Deploy safely",
				source: "skill",
				location: "user",
				path: "skills/deploy/SKILL.md",
			},
		]);
	});

	test("uses an explicitly supplied Extension command host before entering the model turn", async () => {
		const tryExecute = vi.fn(async (text: string) => text.startsWith("/extension"));
		const throwIfExtensionCommand = vi.fn((text: string) => {
			if (text.startsWith("/extension")) throw new Error("cannot queue extension command");
		});
		const fixture = createAdapterFixture("im-claw", {
			tryExecute,
			throwIfExtensionCommand,
			readCommands: () => [{ name: "extension", source: "extension" }],
		});
		const turn = required(fixture.adapter.turn);

		await expect(turn.prompt("/extension value", { source: "rpc" })).resolves.toBeUndefined();
		expect(fixture.prompt).not.toHaveBeenCalled();
		await expect(turn.prompt("normal", { source: "rpc" })).resolves.toBeUndefined();
		expect(fixture.prompt).toHaveBeenCalledOnce();
		await expect(turn.steer("/extension queued", undefined)).rejects.toThrow("cannot queue extension command");
		await expect(turn.followUp("/extension queued", undefined)).rejects.toThrow("cannot queue extension command");
		expect(throwIfExtensionCommand).toHaveBeenCalledTimes(2);
		expect(required(fixture.adapter.commands).readCommands()[0]).toEqual({
			name: "extension",
			source: "extension",
		});
	});
});

describe("RPC session event compatibility", () => {
	test("maps the event fields consumed by IM gateway without claiming full legacy parity", () => {
		const adapter = new RpcSessionEventAdapter();
		const frames = [
			...adapter.map(sessionEvent({ type: "session.lifecycle", phase: "agent_start" })),
			...adapter.map(sessionEvent({ type: "session.lifecycle", phase: "turn_start" })),
			...adapter.map(sessionEvent({ type: "message.delta", delta: "hello" })),
			...adapter.map(sessionEvent({ type: "thinking.delta", delta: "reason" })),
			...adapter.map(
				sessionEvent({
					type: "tool.start",
					toolCallId: "call-1",
					toolName: "read",
					args: { path: "README.md" },
					startedAt: 10,
				}),
			),
			...adapter.map(
				sessionEvent({
					type: "tool.end",
					toolCallId: "call-1",
					toolName: "read",
					isError: false,
					result: { content: [] },
					startedAt: 10,
					durationMs: 5,
					phases: [],
				}),
			),
			...adapter.map(
				sessionEvent({
					type: "session.path_changed",
					previousSessionId: "session-1",
					previousPath: "one.conversation.jsonl",
					path: "two.conversation.jsonl",
					reason: "rollover",
				}),
			),
			...adapter.map(sessionEvent({ type: "session.lifecycle", phase: "turn_end" })),
			...adapter.map(sessionEvent({ type: "session.lifecycle", phase: "agent_end" })),
		];

		expect(frames).toEqual([
			{ type: "agent_start" },
			{ type: "turn_start", turnIndex: 0, timestamp: 100 },
			{
				type: "message_update",
				assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hello" },
			},
			{
				type: "message_update",
				assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "reason" },
			},
			{
				type: "tool_execution_start",
				toolCallId: "call-1",
				toolName: "read",
				args: { path: "README.md" },
				startedAt: 10,
			},
			{
				type: "tool_execution_end",
				toolCallId: "call-1",
				toolName: "read",
				isError: false,
				result: { content: [] },
				startedAt: 10,
				durationMs: 5,
				phases: [],
			},
			{
				type: "session_path_changed",
				from: "one.conversation.jsonl",
				to: "two.conversation.jsonl",
				reason: "rollover",
			},
			{ type: "turn_end", turnIndex: 0 },
			{ type: "agent_end" },
		]);
	});
});

describe("Runtime conversation path identity", () => {
	test("accepts only canonical Runtime files directly under the configured repository", () => {
		const root = join("C:\\", "sessions");
		const sessionId = "session/with unsafe path";
		const encoded = Buffer.from(sessionId, "utf8").toString("base64url");

		expect(resolveSessionIdFromPath(root, join(root, `${encoded}.conversation.jsonl`))).toBe(sessionId);
		expect(resolveSessionIdFromPath(root, join(root, "legacy.jsonl"))).toBeUndefined();
		expect(resolveSessionIdFromPath(root, join(root, "nested", `${encoded}.conversation.jsonl`))).toBeUndefined();
		expect(resolveSessionIdFromPath(root, join(root, "..", `${encoded}.conversation.jsonl`))).toBeUndefined();
	});
});

function createAdapterFixture(
	scenario: CodingAgentRuntimeComposition["scenario"] = "im-claw",
	extensionCommandHost?: CreateImRpcSessionAdapterOptions["extensionCommandHost"],
) {
	let sessionId = "session-1";
	let sessionPath = "session-1.conversation.jsonl";
	let listener: ((event: SessionEvent) => void) | undefined;
	const flushMemory = vi.fn(async () => 4);
	const register = vi.fn<(registration: CodingToolRegistration) => void>();
	const unregister = vi.fn(() => true);
	const disposeSession = vi.fn(async () => {});
	const disposeRuntime = vi.fn(async () => {});
	const prompt = vi.fn<(activeSessionId: string, request: unknown) => Promise<unknown>>(async () => ({
		kind: "started",
	}));
	const newSession = vi.fn(async () => ({ cancelled: false }));
	const switchSession = vi.fn(async () => ({ cancelled: false }));
	const fork = vi.fn(async () => ({ text: "fork prompt", cancelled: false }));
	const core = {
		lifecycle: {
			get sessionId() {
				return sessionId;
			},
			get sessionPath() {
				return sessionPath;
			},
			dispose: disposeSession,
		},
		corePorts: {
			stateReader: {
				readState: () => ({
					thinkingLevel: "medium",
					isStreaming: false,
					messageCount: 1,
					contextPercent: 10,
					contextWindow: 100,
					activeToolNames: [],
				}),
				readMessages: () => [],
			},
		},
		contextController: {
			readState: () => ({ isCompacting: true, autoCompactionEnabled: true }),
			compact: vi.fn(),
			abortCompaction: vi.fn(),
			setAutoCompactionEnabled: vi.fn(),
		},
	} as unknown as GreenfieldRuntimeSessionCoreAssembly;
	const session = {
		get sessionId() {
			return sessionId;
		},
		createCoreAssembly: () => core,
		prompt: (request: unknown) => prompt(sessionId, request),
		abort: vi.fn(async () => {}),
		getState: vi.fn(async () => ({
			sessionId,
			state: "idle",
			pendingMessageCount: 2,
			steeringMode: "all",
			followUpMode: "one-at-a-time",
			messageCount: 1,
		})),
		subscribe: vi.fn((handler: (event: SessionEvent) => void) => {
			listener = handler;
			return () => {
				listener = undefined;
			};
		}),
		dispose: disposeSession,
	} as unknown as GreenfieldRuntimeSession;
	const runtime = {
		scenario,
		tools: { registry: { register, unregister } },
		flushMemory,
		dispose: disposeRuntime,
	} as unknown as CodingAgentRuntimeComposition;
	const sessionHost = {
		readSession: () => session,
		startActiveSessionOperation: <T>(operation: (active: GreenfieldRuntimeSession) => Promise<T>) =>
			operation(session),
		subscribe: (handler: (event: SessionEvent) => void) => session.subscribe(handler),
		newSession,
		switchSession,
		fork,
		dispose: disposeSession,
	};
	const hostToolRegistration = {
		tool: { name: "im_send_attachment" },
		scopeUse: ["im-claw"],
		category: "im",
	} as unknown as CodingToolRegistration;
	const resourceLoader = {
		getPrompts: () => ({
			prompts: [
				{
					name: "review",
					description: "Review changes",
					content: "Review the changes",
					source: "project",
					filePath: "prompts/review.md",
				},
			],
			diagnostics: [],
		}),
		getSkills: () => ({
			skills: [
				{
					name: "deploy",
					description: "Deploy safely",
					source: "user",
					filePath: "skills/deploy/SKILL.md",
					baseDir: "skills/deploy",
					type: "skill" as const,
					disableModelInvocation: false,
				},
			],
			diagnostics: [],
		}),
	} as CreateImRpcSessionAdapterOptions["resourceLoader"];
	return {
		adapter: createImRpcSessionAdapter({
			sessionHost,
			runtime,
			resourceLoader,
			extensionCommandHost,
			createHostToolRegistration: () => hostToolRegistration,
		}),
		disposeRuntime,
		disposeSession,
		flushMemory,
		fork,
		newSession,
		prompt,
		register,
		unregister,
		switchSession,
		emit(event: SessionEvent) {
			listener?.(event);
		},
		setIdentity(nextSessionId: string, nextSessionPath: string) {
			sessionId = nextSessionId;
			sessionPath = nextSessionPath;
		},
	};
}

function createInitialization(): RpcSessionInitialization {
	return {
		uiContext: {} as RpcSessionInitialization["uiContext"],
		hostBridge: { sendAttachment: vi.fn(async () => ({})) },
		onShutdownRequested: vi.fn(),
		onExtensionError: vi.fn(),
	};
}

function sessionEvent(
	event:
		| { readonly type: "session.lifecycle"; readonly phase: "agent_start" | "turn_start" | "turn_end" | "agent_end" }
		| { readonly type: "message.delta"; readonly delta: string }
		| { readonly type: "thinking.delta"; readonly delta: string }
		| {
				readonly type: "tool.start";
				readonly toolCallId: string;
				readonly toolName: string;
				readonly args: unknown;
				readonly startedAt: number;
		  }
		| {
				readonly type: "tool.end";
				readonly toolCallId: string;
				readonly toolName: string;
				readonly isError: boolean;
				readonly result: unknown;
				readonly startedAt: number;
				readonly durationMs: number;
				readonly phases: [];
		  }
		| {
				readonly type: "session.path_changed";
				readonly previousSessionId: string;
				readonly previousPath: string;
				readonly path: string;
				readonly reason: string;
		  },
): SessionEvent {
	return {
		schemaVersion: 1,
		sessionId: "session-1",
		eventId: "event-1",
		timestamp: 100,
		source: "runtime-core",
		...event,
	} as SessionEvent;
}

function required<T>(value: T | undefined): T {
	if (!value) throw new Error("Expected capability");
	return value;
}
