import { FakeRelay, RemoteConnection } from "@vetta/remote-control";
import { describe, expect, it } from "vitest";
import { DesktopRemoteConnector, type DesktopRemoteOperations } from "./desktop-remote-connector.js";

describe("DesktopRemoteConnector", () => {
	it("maps protocol requests to desktop operations and streams events", async () => {
		const relay = new FakeRelay();
		const mobile = new RemoteConnection(relay.createTransport("pair-1", "mobile"), {
			role: "mobile",
			deviceId: "phone-1",
			deviceName: "Phone",
			capabilities: { chat: true, sessionRead: true },
			connectionId: "mobile-connection",
		});
		const desktop = new RemoteConnection(relay.createTransport("pair-1", "desktop"), {
			role: "desktop",
			deviceId: "desktop-1",
			deviceName: "Desktop",
			capabilities: { chat: true, sessionRead: true },
			connectionId: "desktop-connection",
		});
		const operations: DesktopRemoteOperations = {
			listSessions: async () => [{ id: "session-1", title: "Project" }],
			createSession: async () => ({ sessionId: "session-new" }),
			openSession: async (sessionId) => ({ sessionId }),
			prompt: async function* (_sessionId, text) {
				yield { type: "delta", text: `reply:${text}` };
				yield { type: "state", payload: { state: "completed" } };
			},
			abort: async () => undefined,
			resume: async () => undefined,
			diagnostics: async () => ({ state: "online" }),
		};
		const connector = new DesktopRemoteConnector(desktop, operations);
		const events: unknown[] = [];
		mobile.onEvent((event) => {
			if (event.type === "remote-event") events.push(event.event.payload);
		});

		await mobile.connect();
		await connector.start();
		await expect(mobile.request("session.list")).resolves.toEqual({
			sessions: [{ id: "session-1", title: "Project" }],
		});
		await expect(mobile.request("session.prompt", { text: "hello" })).resolves.toEqual({
			accepted: true,
			sessionId: "session-new",
		});
		await waitFor(() => events.length === 2);
		expect(events).toEqual([{ kind: "delta", text: "reply:hello" }, { state: "completed" }]);

		await connector.stop();
	});

	it("maps provider authentication failures without exposing provider messages", async () => {
		const relay = new FakeRelay();
		const mobile = new RemoteConnection(relay.createTransport("pair-auth", "mobile"), {
			role: "mobile",
			deviceId: "phone-1",
			deviceName: "Phone",
			capabilities: { chat: true, sessionRead: true },
			connectionId: "mobile-auth-connection",
		});
		const desktop = new RemoteConnection(relay.createTransport("pair-auth", "desktop"), {
			role: "desktop",
			deviceId: "desktop-1",
			deviceName: "Desktop",
			capabilities: { chat: true, sessionRead: true },
			connectionId: "desktop-auth-connection",
		});
		const operations: DesktopRemoteOperations = {
			listSessions: async () => [],
			createSession: async () => ({ sessionId: "session-new" }),
			openSession: async (sessionId) => ({ sessionId }),
			prompt: async function* () {
				yield { type: "state", payload: { state: "running" } };
				throw Object.assign(new Error("invalid key suffix: sensitive"), {
					code: "TURN_FAILED",
					details: {
						code: "AI_AUTHENTICATION_FAILED",
						retryable: false,
						origin: "provider",
					},
				});
			},
			abort: async () => undefined,
			resume: async () => undefined,
			diagnostics: async () => ({}),
		};
		const connector = new DesktopRemoteConnector(desktop, operations);
		const errors: unknown[] = [];
		mobile.onEvent((event) => {
			if (event.type === "remote-event" && event.event.name === "session.state") errors.push(event.event.payload);
		});

		await mobile.connect();
		await connector.start();
		await expect(mobile.request("session.prompt", { text: "hello" })).resolves.toEqual({
			accepted: true,
			sessionId: "session-new",
		});
		await waitFor(() => errors.some((value) => (value as { state?: string }).state === "error"));
		expect(errors.at(-1)).toEqual({
			state: "error",
			code: "unauthorized",
			message: "Desktop model authentication failed",
		});

		await connector.stop();
		await mobile.close();
	});

	it("keeps a remote turn alive while waiting for a user answer", async () => {
		const relay = new FakeRelay();
		const mobile = new RemoteConnection(relay.createTransport("pair-question", "mobile"), {
			role: "mobile",
			deviceId: "phone-1",
			deviceName: "Phone",
			capabilities: { chat: true, sessionRead: true },
			connectionId: "mobile-question-connection",
		});
		const desktop = new RemoteConnection(relay.createTransport("pair-question", "desktop"), {
			role: "desktop",
			deviceId: "desktop-1",
			deviceName: "Desktop",
			capabilities: { chat: true, sessionRead: true },
			connectionId: "desktop-question-connection",
		});
		let releaseQuestion: (() => void) | undefined;
		let receivedAnswer: unknown;
		const operations: DesktopRemoteOperations = {
			listSessions: async () => [],
			createSession: async () => ({ sessionId: "session-question" }),
			openSession: async (sessionId) => ({ sessionId }),
			prompt: async function* () {
				yield {
					type: "input",
					payload: {
						kind: "question",
						requestId: "question-1",
						questions: [{ question: "继续吗？", header: "确认", options: [{ label: "继续", description: "" }] }],
					},
				};
				await new Promise<void>((resolve) => {
					releaseQuestion = resolve;
				});
				yield {
					type: "delta",
					text: `continued:${String((receivedAnswer as { answers?: unknown[] })?.answers?.length ?? 0)}`,
				};
				yield { type: "state", payload: { state: "completed" } };
			},
			abort: async () => undefined,
			respond: async (_sessionId, _requestId, result) => {
				receivedAnswer = result;
				releaseQuestion?.();
			},
			resume: async () => undefined,
			diagnostics: async () => ({}),
		};
		const connector = new DesktopRemoteConnector(desktop, operations);
		const events: unknown[] = [];
		mobile.onEvent((event) => {
			if (event.type === "remote-event") events.push(event.event.payload);
		});

		await mobile.connect();
		await connector.start();
		await expect(mobile.request("session.prompt", { text: "hello" })).resolves.toEqual({
			accepted: true,
			sessionId: "session-question",
		});
		await waitFor(() => events.some((value) => (value as { kind?: string }).kind === "question"));
		await expect(
			mobile.request(
				"session.respond",
				{
					requestId: "question-1",
					cancelled: false,
					answers: [{ question: "继续吗？", answers: ["继续"] }],
				},
				"session-question",
			),
		).resolves.toEqual({ responded: true });
		await waitFor(
			() =>
				events.includes({ kind: "delta", text: "continued:1" }) ||
				events.some((value) => (value as { text?: string }).text === "continued:1"),
		);
		expect(receivedAnswer).toMatchObject({
			cancelled: false,
			answers: [{ question: "继续吗？", answers: ["继续"] }],
		});

		await connector.stop();
		await mobile.close();
	});
});

async function waitFor(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 3_000;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("condition was not met");
}
