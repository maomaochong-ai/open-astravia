import {
	CODING_AGENT_ASK_USER_QUESTION_FUNCTION,
	CODING_AGENT_SANDBOX_AUTHORIZATION_FUNCTION,
	type CodingAgentQuestionFunctionRequest,
} from "@vetta/coding-agent/function-extensions";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDesktopSandboxAuthorizationBroker } from "../conversations/sandbox-authorization-broker.js";
import { getDesktopUserQuestionBroker } from "../conversations/user-question-broker.js";
import { createDesktopCodingAgentFunctionSource } from "./function-extension-source.js";

const TEST_LOGGER = { warn: vi.fn() };

describe("Desktop Coding Agent function source", () => {
	const disposals: Array<() => void> = [];

	afterEach(() => {
		for (const dispose of disposals.splice(0).reverse()) dispose();
	});

	it("binds explicit questions to the rebindable question broker", async () => {
		const source = createDesktopCodingAgentFunctionSource({ logger: TEST_LOGGER });
		expect(source.has(CODING_AGENT_ASK_USER_QUESTION_FUNCTION)).toBe(false);

		const handler = vi.fn(async (request: CodingAgentQuestionFunctionRequest) => ({
			cancelled: false,
			answers: [{ question: request.questions[0]?.question ?? "", answers: ["允许"] }],
		}));
		disposals.push(getDesktopUserQuestionBroker().setInteractiveHandler(handler));
		expect(source.has(CODING_AGENT_ASK_USER_QUESTION_FUNCTION)).toBe(true);
		const signal = new AbortController().signal;

		await expect(
			source.invoke(
				CODING_AGENT_ASK_USER_QUESTION_FUNCTION,
				{
					requestId: "question-1",
					sessionId: "session-1",
					questions: [{ question: "Choose?", header: "Choice", options: [] }],
				},
				signal,
			),
		).resolves.toEqual({
			cancelled: false,
			answers: [{ question: "Choose?", answers: ["允许"] }],
		});
		expect(handler).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: "question-1",
				questions: [{ question: "Choose?", header: "Choice", options: [] }],
			}),
			signal,
		);
	});

	it("binds Sandbox authorization without exposing the product protocol to Runtime", async () => {
		const source = createDesktopCodingAgentFunctionSource({ logger: TEST_LOGGER });
		expect(source.has(CODING_AGENT_SANDBOX_AUTHORIZATION_FUNCTION)).toBe(false);
		const handler = vi.fn(async () => "allow_once" as const);
		const unregister = getDesktopSandboxAuthorizationBroker().setInteractiveHandler(handler);
		disposals.push(unregister);
		expect(source.has(CODING_AGENT_SANDBOX_AUTHORIZATION_FUNCTION)).toBe(true);
		const request = {
			requestId: "sandbox-1",
			sessionId: "session-1",
			title: "Sandbox authorization",
			message: "Allow write",
			toolName: "write",
			capability: "file.write" as const,
			target: "../outside.txt",
			resolvedTarget: "/outside.txt",
			grantRoot: "/",
			sensitive: false,
		};
		const signal = new AbortController().signal;

		await expect(source.invoke(CODING_AGENT_SANDBOX_AUTHORIZATION_FUNCTION, request, signal)).resolves.toBe(
			"allow_once",
		);
		expect(handler).toHaveBeenCalledWith(request, signal);
		unregister();
		expect(source.has(CODING_AGENT_SANDBOX_AUTHORIZATION_FUNCTION)).toBe(false);
	});
});
