import { RemoteConnection, WebSocketRemoteTransport } from "@vetta/remote-control";
import { DesktopRemoteConnector, type DesktopRemoteOperations } from "../src/main/remote-control/desktop-remote-connector.js";

const connection = new RemoteConnection(
	new WebSocketRemoteTransport("ws://127.0.0.1:8787/relay/mobile-desktop-e2e/desktop"),
	{
		role: "desktop",
		deviceId: "desktop-harness",
		deviceName: "Desktop E2E Harness",
		capabilities: { chat: true, sessionRead: true },
		connectionId: "desktop-harness-connection",
	},
);

const operations: DesktopRemoteOperations = {
	listSessions: async () => [],
	createSession: async () => ({ sessionId: "desktop-e2e-session" }),
	openSession: async (sessionId) => ({ sessionId }),
	prompt: async function* (_sessionId, text) {
		yield { type: "delta", text: `desktop:${text}` };
	},
	abort: async () => undefined,
	resume: async () => undefined,
	diagnostics: async () => ({ state: "online", harness: true }),
};

const connector = new DesktopRemoteConnector(connection, operations);
await connector.start();
console.info("[remote-connector-harness] online");

const stop = async (): Promise<void> => {
	await connector.stop();
	process.exit(0);
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
