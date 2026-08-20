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
			completed: true,
			sessionId: "session-new",
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(events).toEqual([{ kind: "delta", text: "reply:hello" }]);

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
		const errors: Array<{ code: string; message: string }> = [];
		mobile.onEvent((event) => {
			if (event.type === "error") errors.push(event.error);
		});

		await mobile.connect();
		await connector.start();
		await expect(mobile.request("session.prompt", { text: "hello" })).rejects.toThrow(
			"Desktop model authentication failed",
		);
		expect(errors).toEqual([
			{ code: "unauthorized", message: "Desktop model authentication failed", retryable: false },
		]);

		await connector.stop();
		await mobile.close();
	});
});
