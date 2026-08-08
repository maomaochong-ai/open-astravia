import type { Message } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { agentLoopContinue } from "../src/agent-loop.js";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage } from "../src/types.js";
import {
	createAssistantMessage,
	createModel,
	createUserMessage,
	identityConverter,
	MockAssistantStream,
} from "./support/agent-loop-fixtures.js";

describe("agentLoopContinue with AgentMessage", () => {
	it("should throw when context has no messages", () => {
		const context: AgentContext = {
			systemPrompt: "You are helpful.",
			messages: [],
			tools: [],
		};

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		expect(() => agentLoopContinue(context, config)).toThrow("Cannot continue: no messages in context");
	});

	it("should continue from existing context without emitting user message events", async () => {
		const userMessage: AgentMessage = createUserMessage("Hello");
		const context: AgentContext = {
			systemPrompt: "You are helpful.",
			messages: [userMessage],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};
		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				stream.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([{ type: "text", text: "Response" }]),
				});
			});
			return stream;
		};

		const events: AgentEvent[] = [];
		const stream = agentLoopContinue(context, config, undefined, streamFn);
		for await (const event of stream) events.push(event);

		const messages = await stream.result();
		expect(messages).toHaveLength(1);
		expect(messages[0].role).toBe("assistant");
		const messageEndEvents = events.filter((event) => event.type === "message_end");
		expect(messageEndEvents).toHaveLength(1);
		expect(messageEndEvents[0]?.message.role).toBe("assistant");
	});

	it("should allow custom message types as last message (caller responsibility)", async () => {
		interface CustomMessage {
			role: "custom";
			text: string;
			timestamp: number;
		}
		const customMessage: CustomMessage = {
			role: "custom",
			text: "Hook content",
			timestamp: Date.now(),
		};
		const context: AgentContext = {
			systemPrompt: "You are helpful.",
			messages: [customMessage as unknown as AgentMessage],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: (messages) =>
				messages
					.map((message) => {
						const candidate = message as unknown as Partial<CustomMessage>;
						if (candidate.role !== "custom") return message;
						return {
							role: "user" as const,
							content: candidate.text ?? "",
							timestamp: message.timestamp,
						};
					})
					.filter(
						(message) => message.role === "user" || message.role === "assistant" || message.role === "toolResult",
					) as Message[],
		};
		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				stream.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([{ type: "text", text: "Response to custom message" }]),
				});
			});
			return stream;
		};

		const stream = agentLoopContinue(context, config, undefined, streamFn);
		const events: AgentEvent[] = [];
		for await (const event of stream) events.push(event);

		const messages = await stream.result();
		expect(messages).toHaveLength(1);
		expect(messages[0].role).toBe("assistant");
	});

	it("waits for a model-call context checkpoint before invoking the model", async () => {
		const preparedMessage = createUserMessage("prepared");
		let modelCalls = 0;
		const stream = agentLoopContinue(
			{ systemPrompt: "You are helpful.", messages: [createUserMessage("original")], tools: [] },
			{ model: createModel(), convertToLlm: identityConverter, contextCheckpoints: true },
			undefined,
			(_model, context) => {
				modelCalls += 1;
				expect(context.messages).toEqual([preparedMessage]);
				const response = new MockAssistantStream();
				queueMicrotask(() => {
					response.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "done" }]),
					});
				});
				return response;
			},
		);

		for await (const event of stream) {
			if (event.type !== "context_checkpoint") continue;
			if (event.request.reason === "model_call") {
				expect(modelCalls).toBe(0);
				event.request.complete({ messages: [preparedMessage] });
				continue;
			}
			expect(event.request.reason).toBe("assistant_result");
			expect(modelCalls).toBe(1);
			event.request.complete();
		}

		expect(modelCalls).toBe(1);
	});

	it("ends without calling the model when a context checkpoint fails", async () => {
		let modelCalls = 0;
		const stream = agentLoopContinue(
			{ systemPrompt: "You are helpful.", messages: [createUserMessage("original")], tools: [] },
			{ model: createModel(), convertToLlm: identityConverter, contextCheckpoints: true },
			undefined,
			() => {
				modelCalls += 1;
				return new MockAssistantStream();
			},
		);

		for await (const event of stream) {
			if (event.type === "context_checkpoint") event.request.fail(new Error("checkpoint failed"));
		}

		expect(modelCalls).toBe(0);
		expect(await stream.result()).toEqual([]);
	});

	it("retries an assistant error only when the host checkpoint requests recovery", async () => {
		const initialMessage = createUserMessage("hello");
		const steeringMessage = createUserMessage("steer during recovery");
		const responses = [
			createAssistantMessage([{ type: "text", text: "overflow" }], "error"),
			createAssistantMessage([{ type: "text", text: "recovered" }]),
		];
		let modelCalls = 0;
		let steeringDelivered = false;
		const recoveryAttempts: number[] = [];
		const callRoles: string[][] = [];
		const stream = agentLoopContinue(
			{ systemPrompt: "You are helpful.", messages: [initialMessage], tools: [] },
			{
				model: createModel(),
				convertToLlm: identityConverter,
				contextCheckpoints: true,
				getSteeringMessages: async () => {
					if (modelCalls !== 1 || steeringDelivered) return [];
					steeringDelivered = true;
					return [steeringMessage];
				},
			},
			undefined,
			(_model, context) => {
				callRoles.push(context.messages.map(({ role }) => role));
				const response = new MockAssistantStream();
				const message = responses[modelCalls];
				modelCalls += 1;
				if (!message) throw new Error("Missing response");
				queueMicrotask(() => {
					if (message.stopReason === "error") {
						response.push({ type: "error", reason: "error", error: message });
						return;
					}
					response.push({ type: "done", reason: "stop", message });
				});
				return response;
			},
		);

		for await (const event of stream) {
			if (event.type !== "context_checkpoint") continue;
			if (event.request.reason === "model_call" || event.request.reason === "assistant_result") {
				event.request.complete();
				continue;
			}
			recoveryAttempts.push(event.request.recoveryAttempt);
			event.request.complete({ messages: [initialMessage], contextMessages: [initialMessage], retry: true });
		}

		expect(modelCalls).toBe(2);
		expect(recoveryAttempts).toEqual([0]);
		expect(callRoles).toEqual([["user"], ["user", "user"]]);
		expect((await stream.result()).map(({ role }) => role)).toEqual(["assistant", "user", "assistant"]);
	});
});
