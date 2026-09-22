import type { CodingAgentQuestionFunctionRequest } from "@vetta/coding-agent/function-extensions";
import { describe, expect, it } from "vitest";
import { DesktopUserQuestionBroker } from "./user-question-broker.js";

const request: CodingAgentQuestionFunctionRequest = {
	requestId: "q-1",
	sessionId: "session-1",
	questions: [{ question: "Deploy now?", header: "Deploy", options: [{ label: "Yes", description: "" }] }],
};

describe("DesktopUserQuestionBroker", () => {
	it("lets an external party settle a pending question by requestId and cancels the interactive handler", async () => {
		const broker = new DesktopUserQuestionBroker();
		let interactiveAborted = false;
		broker.setInteractiveHandler(
			(_request, signal) =>
				new Promise((resolve) => {
					signal?.addEventListener("abort", () => {
						interactiveAborted = true;
						resolve({ cancelled: true, answers: [] });
					});
				}),
		);
		const asked: string[] = [];
		broker.onQuestionAsked((asked_request) => asked.push(asked_request.requestId));

		const pending = broker.handle(request);
		await Promise.resolve();
		expect(asked).toEqual(["q-1"]);
		expect(broker.listPendingQuestions().map((entry) => entry.requestId)).toEqual(["q-1"]);

		expect(broker.answer("q-1", { cancelled: false, answers: [{ question: "Deploy now?", answers: ["Yes"] }] })).toBe(
			true,
		);
		await expect(pending).resolves.toEqual({
			cancelled: false,
			answers: [{ question: "Deploy now?", answers: ["Yes"] }],
		});
		expect(interactiveAborted).toBe(true);
		expect(broker.listPendingQuestions()).toEqual([]);
		expect(broker.answer("q-1", { cancelled: true, answers: [] })).toBe(false);
	});

	it("still lets the interactive handler win and reports the resolution once", async () => {
		const broker = new DesktopUserQuestionBroker();
		broker.setInteractiveHandler(async () => ({
			cancelled: false,
			answers: [{ question: "Deploy now?", answers: ["No"] }],
		}));
		const resolved: string[] = [];
		broker.onQuestionResolved((event) => resolved.push(event.requestId));

		await expect(broker.handle(request)).resolves.toEqual({
			cancelled: false,
			answers: [{ question: "Deploy now?", answers: ["No"] }],
		});
		expect(resolved).toEqual(["q-1"]);
		expect(broker.answer("q-1", { cancelled: true, answers: [] })).toBe(false);
	});

	it("returns cancelled when nobody can answer", async () => {
		const broker = new DesktopUserQuestionBroker();
		await expect(broker.handle(request)).resolves.toEqual({ cancelled: true, answers: [] });
	});
});
