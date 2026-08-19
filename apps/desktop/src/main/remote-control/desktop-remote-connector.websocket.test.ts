import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import { RemoteConnection, WebSocketRemoteTransport } from "@vetta/remote-control";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DesktopRemoteConnector, type DesktopRemoteOperations } from "./desktop-remote-connector.js";

const relayPort = 18_787;
let relayProcess: ChildProcess;

beforeAll(async () => {
	relayProcess = spawn(
		"bun",
		[resolve(__dirname, "../../../../../packages/remote-control/scripts/fake-relay-server.ts")],
		{
			cwd: resolve(__dirname, "../../../../../packages/remote-control"),
			env: { ...process.env, VETTA_FAKE_RELAY_PORT: String(relayPort) },
			stdio: "ignore",
		},
	);
	await waitForRelay();
});

afterAll(() => {
	relayProcess.kill();
});

describe("DesktopRemoteConnector WebSocket integration", () => {
	it("runs a prompt through the local relay process", async () => {
		const baseUrl = `ws://127.0.0.1:${relayPort}/relay/integration`;
		const mobile = connection(`${baseUrl}/mobile`, "mobile", "phone-1", "mobile-connection");
		const desktop = connection(`${baseUrl}/desktop`, "desktop", "desktop-1", "desktop-connection");
		const operations: DesktopRemoteOperations = {
			listSessions: async () => [],
			createSession: async () => ({ sessionId: "runtime-session-1" }),
			openSession: async (sessionId) => ({ sessionId }),
			prompt: async function* (_sessionId, text) {
				yield { type: "delta", text: `relay:${text}` };
			},
			abort: async () => undefined,
			resume: async () => undefined,
			diagnostics: async () => ({ state: "online" }),
		};
		const connector = new DesktopRemoteConnector(desktop, operations);
		const deltas: unknown[] = [];
		mobile.onEvent((event) => {
			if (event.type === "remote-event" && event.event.name === "session.message") deltas.push(event.event.payload);
		});

		await mobile.connect();
		await connector.start();
		await waitForOnline(mobile);
		await expect(mobile.request("session.prompt", { text: "hello" })).resolves.toEqual({
			completed: true,
			sessionId: "runtime-session-1",
		});
		expect(deltas).toEqual([{ kind: "delta", text: "relay:hello" }]);

		await connector.stop();
		await mobile.close();
	}, 10_000);
});

function connection(url: string, role: "mobile" | "desktop", deviceId: string, connectionId: string) {
	return new RemoteConnection(new WebSocketRemoteTransport(url), {
		role,
		deviceId,
		deviceName: deviceId,
		capabilities: { chat: true, sessionRead: true },
		connectionId,
		requestTimeoutMs: 3_000,
	});
}

async function waitForRelay(): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		if (relayProcess.exitCode !== null) throw new Error("fake relay exited before becoming ready");
		const ready = await fetch(`http://127.0.0.1:${relayPort}/health`)
			.then((response) => response.ok)
			.catch(() => false);
		if (ready) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("fake relay did not become ready");
}

async function waitForOnline(connection: RemoteConnection): Promise<void> {
	const deadline = Date.now() + 3_000;
	while (Date.now() < deadline) {
		if (connection.getSnapshot().state === "online") return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("remote connection did not become online");
}
