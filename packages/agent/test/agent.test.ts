import { Type } from "@sinclair/typebox";
import { type AssistantMessage, type AssistantMessageEvent, EventStream, type Model } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { Agent } from "../src/index.js";
import type { AgentTool } from "../src/types.js";

const lateToolSchema = Type.Object({});

// Mock stream that mimics AssistantMessageEventStream
class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function createAssistantMessageWithToolCall(name: string): AssistantMessage {
	return {
		...createAssistantMessage(""),
		content: [{ type: "toolCall", id: `call-${name}`, name, arguments: {} }],
		stopReason: "toolUse",
	};
}

function createMockModel(): Model<"openai-responses"> {
	return {
		id: "mock",
		name: "Mock",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 4096,
	};
}

describe("Agent", () => {
	it("should create an agent instance with default state", () => {
		const agent = new Agent();

		expect(agent.state).toBeDefined();
		expect(agent.state.systemPrompt).toBe("");
		expect(agent.state.model).toBeUndefined();
		expect(agent.state.thinkingLevel).toBe("off");
		expect(agent.state.tools).toEqual([]);
		expect(agent.state.messages).toEqual([]);
		expect(agent.state.isStreaming).toBe(false);
		expect(agent.state.streamMessage).toBe(null);
		expect(agent.state.pendingToolCalls).toEqual(new Set());
		expect(agent.state.error).toBeUndefined();
	});

	it("should create an agent instance with custom initial state", () => {
		const customModel = createMockModel();
		const agent = new Agent({
			initialState: {
				systemPrompt: "You are a helpful assistant.",
				model: customModel,
				thinkingLevel: "low",
			},
		});

		expect(agent.state.systemPrompt).toBe("You are a helpful assistant.");
		expect(agent.state.model).toBe(customModel);
		expect(agent.state.thinkingLevel).toBe("low");
	});

	it("should subscribe to events", () => {
		const agent = new Agent();

		let eventCount = 0;
		const unsubscribe = agent.subscribe((_event) => {
			eventCount++;
		});

		// No initial event on subscribe
		expect(eventCount).toBe(0);

		// State mutators don't emit events
		agent.setSystemPrompt("Test prompt");
		expect(eventCount).toBe(0);
		expect(agent.state.systemPrompt).toBe("Test prompt");

		// Unsubscribe should work
		unsubscribe();
		agent.setSystemPrompt("Another prompt");
		expect(eventCount).toBe(0); // Should not increase
	});

	it("should update state with mutators", () => {
		const agent = new Agent();

		// Test setSystemPrompt
		agent.setSystemPrompt("Custom prompt");
		expect(agent.state.systemPrompt).toBe("Custom prompt");

		// Test setModel
		const newModel = createMockModel();
		agent.setModel(newModel);
		expect(agent.state.model).toBe(newModel);

		// Test setThinkingLevel
		agent.setThinkingLevel("high");
		expect(agent.state.thinkingLevel).toBe("high");

		// Test setTools
		const tools = [{ name: "test", description: "test tool" } as any];
		agent.setTools(tools);
		expect(agent.state.tools).toBe(tools);

		// Test replaceMessages
		const messages = [{ role: "user" as const, content: "Hello", timestamp: Date.now() }];
		agent.replaceMessages(messages);
		expect(agent.state.messages).toEqual(messages);
		expect(agent.state.messages).not.toBe(messages); // Should be a copy

		// Test appendMessage
		const newMessage = { role: "assistant" as const, content: [{ type: "text" as const, text: "Hi" }] };
		agent.appendMessage(newMessage as any);
		expect(agent.state.messages).toHaveLength(2);
		expect(agent.state.messages[1]).toBe(newMessage);

		// Test clearMessages
		agent.clearMessages();
		expect(agent.state.messages).toEqual([]);
	});

	it("should support steering message queue", async () => {
		const agent = new Agent();

		const message = { role: "user" as const, content: "Steering message", timestamp: Date.now() };
		agent.steer(message);

		// The message is queued but not yet in state.messages
		expect(agent.state.messages).not.toContainEqual(message);
	});

	it("should support follow-up message queue", async () => {
		const agent = new Agent();

		const message = { role: "user" as const, content: "Follow-up message", timestamp: Date.now() };
		agent.followUp(message);

		// The message is queued but not yet in state.messages
		expect(agent.state.messages).not.toContainEqual(message);
	});

	it("should handle abort controller", () => {
		const agent = new Agent();

		// Should not throw even if nothing is running
		expect(() => agent.abort()).not.toThrow();
	});

	it("should throw when prompt() called while streaming", async () => {
		let abortSignal: AbortSignal | undefined;
		const agent = new Agent({
			initialState: { model: createMockModel() },
			// Use a stream function that responds to abort
			streamFn: (_model, _context, options) => {
				abortSignal = options?.signal;
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: createAssistantMessage("") });
					// Check abort signal periodically
					const checkAbort = () => {
						if (abortSignal?.aborted) {
							stream.push({ type: "error", reason: "aborted", error: createAssistantMessage("Aborted") });
						} else {
							setTimeout(checkAbort, 5);
						}
					};
					checkAbort();
				});
				return stream;
			},
		});

		// Start first prompt (don't await, it will block until abort)
		const firstPrompt = agent.prompt("First message");

		// Wait a tick for isStreaming to be set
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(agent.state.isStreaming).toBe(true);

		// Second prompt should reject
		await expect(agent.prompt("Second message")).rejects.toThrow(
			"Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.",
		);

		// Cleanup - abort to stop the stream
		agent.abort();
		await firstPrompt.catch(() => {}); // Ignore abort error
	});

	it("should throw when continue() called while streaming", async () => {
		let abortSignal: AbortSignal | undefined;
		const agent = new Agent({
			initialState: { model: createMockModel() },
			streamFn: (_model, _context, options) => {
				abortSignal = options?.signal;
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: createAssistantMessage("") });
					const checkAbort = () => {
						if (abortSignal?.aborted) {
							stream.push({ type: "error", reason: "aborted", error: createAssistantMessage("Aborted") });
						} else {
							setTimeout(checkAbort, 5);
						}
					};
					checkAbort();
				});
				return stream;
			},
		});

		// Start first prompt
		const firstPrompt = agent.prompt("First message");
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(agent.state.isStreaming).toBe(true);

		// continue() should reject
		await expect(agent.continue()).rejects.toThrow(
			"Agent is already processing. Wait for completion before continuing.",
		);

		// Cleanup
		agent.abort();
		await firstPrompt.catch(() => {});
	});

	it("continue() should process queued follow-up messages after an assistant turn", async () => {
		const agent = new Agent({
			initialState: { model: createMockModel() },
			streamFn: () => {
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "done", reason: "stop", message: createAssistantMessage("Processed") });
				});
				return stream;
			},
		});

		agent.replaceMessages([
			{
				role: "user",
				content: [{ type: "text", text: "Initial" }],
				timestamp: Date.now() - 10,
			},
			createAssistantMessage("Initial response"),
		]);

		agent.followUp({
			role: "user",
			content: [{ type: "text", text: "Queued follow-up" }],
			timestamp: Date.now(),
		});

		await expect(agent.continue()).resolves.toBeUndefined();

		const hasQueuedFollowUp = agent.state.messages.some((message) => {
			if (message.role !== "user") return false;
			if (typeof message.content === "string") return message.content === "Queued follow-up";
			return message.content.some((part) => part.type === "text" && part.text === "Queued follow-up");
		});

		expect(hasQueuedFollowUp).toBe(true);
		expect(agent.state.messages[agent.state.messages.length - 1].role).toBe("assistant");
	});

	it("should continue from an async continuation provider at a natural stopping point", async () => {
		let responseCount = 0;
		let providerCount = 0;
		const agent = new Agent({
			initialState: { model: createMockModel() },
			streamFn: () => {
				const stream = new MockAssistantStream();
				responseCount++;
				queueMicrotask(() => {
					stream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage(`Response ${responseCount}`),
					});
				});
				return stream;
			},
		});
		agent.continuationProvider = async () => {
			providerCount++;
			if (providerCount > 1) return [];
			return [
				{
					role: "user",
					content: [{ type: "text", text: "Continue automatically" }],
					timestamp: Date.now(),
				},
			];
		};

		await agent.prompt("Start");

		expect(responseCount).toBe(2);
		expect(providerCount).toBe(2);
		expect(
			agent.state.messages.some(
				(message) =>
					message.role === "user" &&
					Array.isArray(message.content) &&
					message.content.some((part) => part.type === "text" && part.text === "Continue automatically"),
			),
		).toBe(true);
	});

	it("continue() should keep one-at-a-time steering semantics from assistant tail", async () => {
		let responseCount = 0;
		const agent = new Agent({
			initialState: { model: createMockModel() },
			streamFn: () => {
				const stream = new MockAssistantStream();
				responseCount++;
				queueMicrotask(() => {
					stream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage(`Processed ${responseCount}`),
					});
				});
				return stream;
			},
		});

		agent.replaceMessages([
			{
				role: "user",
				content: [{ type: "text", text: "Initial" }],
				timestamp: Date.now() - 10,
			},
			createAssistantMessage("Initial response"),
		]);

		agent.steer({
			role: "user",
			content: [{ type: "text", text: "Steering 1" }],
			timestamp: Date.now(),
		});
		agent.steer({
			role: "user",
			content: [{ type: "text", text: "Steering 2" }],
			timestamp: Date.now() + 1,
		});

		await expect(agent.continue()).resolves.toBeUndefined();

		const recentMessages = agent.state.messages.slice(-4);
		expect(recentMessages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
		expect(responseCount).toBe(2);
	});

	it("forwards sessionId to streamFn options", async () => {
		let receivedSessionId: string | undefined;
		const agent = new Agent({
			initialState: { model: createMockModel() },
			sessionId: "session-abc",
			streamFn: (_model, _context, options) => {
				receivedSessionId = options?.sessionId;
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					const message = createAssistantMessage("ok");
					stream.push({ type: "done", reason: "stop", message });
				});
				return stream;
			},
		});

		await agent.prompt("hello");
		expect(receivedSessionId).toBe("session-abc");

		// Test setter
		agent.sessionId = "session-def";
		expect(agent.sessionId).toBe("session-def");

		await agent.prompt("hello again");
		expect(receivedSessionId).toBe("session-def");
	});

	// Regression: tools/system prompt registered mid-run (tool_search activating MCP
	// tools) must reach the very next LLM request, not the next prompt().
	it("applies setTools/setSystemPrompt made during a run to the next request", async () => {
		const lateTool: AgentTool<typeof lateToolSchema, undefined> = {
			label: "Late",
			name: "late_tool",
			description: "Activated mid-run",
			parameters: lateToolSchema,
			execute: async () => ({ content: [{ type: "text", text: "late" }], details: undefined }),
		};

		let agent: Agent;
		const activator: AgentTool<typeof lateToolSchema, undefined> = {
			label: "Activator",
			name: "activator",
			description: "Activates late_tool",
			parameters: lateToolSchema,
			execute: async () => {
				agent.setTools([...agent.state.tools, lateTool]);
				agent.setSystemPrompt("updated");
				return { content: [{ type: "text", text: "activated" }], details: undefined };
			},
		};

		const seenToolNames: string[][] = [];
		const seenSystemPrompts: (string | undefined)[] = [];
		let responseCount = 0;
		agent = new Agent({
			initialState: { model: createMockModel(), systemPrompt: "base", tools: [activator] },
			streamFn: (_model, context) => {
				seenToolNames.push((context.tools ?? []).map((tool) => tool.name));
				seenSystemPrompts.push(context.systemPrompt);
				responseCount++;
				const stream = new MockAssistantStream();
				const message =
					responseCount === 1 ? createAssistantMessageWithToolCall("activator") : createAssistantMessage("done");
				queueMicrotask(() => stream.push({ type: "done", reason: "stop", message }));
				return stream;
			},
		});

		await agent.prompt("go");

		expect(responseCount).toBe(2);
		expect(seenToolNames[0]).toEqual(["activator"]);
		expect(seenToolNames[1]).toEqual(["activator", "late_tool"]);
		expect(seenSystemPrompts).toEqual(["base", "updated"]);
	});
});
