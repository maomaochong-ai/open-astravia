import { hostname } from "node:os";
import { RemoteConnection, WebSocketRemoteTransport } from "@vetta/remote-control";
import { getDesktopConversationService } from "../conversations/desktop-conversation-service.js";
import { getAppLogger } from "../logger.js";
import { DesktopConversationRemoteOperations } from "./desktop-conversation-remote-operations.js";
import { DesktopRemoteConnector } from "./desktop-remote-connector.js";

export interface DesktopRemoteAccessOptions {
	readonly controlUrl: string;
	readonly pairingToken: string;
	readonly conversationCwd: string;
}

interface ActiveConnector {
	readonly connector: DesktopRemoteConnector;
	readonly unsubscribe: () => void;
}

const log = getAppLogger("remote-access");
let active: ActiveConnector | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let reconnectDelayMs = 1_000;

export async function startDesktopRemoteAccess(options: DesktopRemoteAccessOptions): Promise<void> {
	if (active || reconnectTimer) return;
	const runGeneration = ++generation;
	await connect(options, runGeneration);
}

export async function stopDesktopRemoteAccess(): Promise<void> {
	generation += 1;
	if (reconnectTimer) clearTimeout(reconnectTimer);
	reconnectTimer = undefined;
	const current = active;
	active = undefined;
	current?.unsubscribe();
	if (current) await current.connector.stop();
	reconnectDelayMs = 1_000;
	log.info("remote access connector stopped");
}

async function connect(options: DesktopRemoteAccessOptions, runGeneration: number): Promise<void> {
	if (runGeneration !== generation) return;
	const deviceId = `desktop-${hostname()
		.replace(/[^A-Za-z0-9_-]/g, "-")
		.slice(0, 64)}`;
	const connection = new RemoteConnection(
		new WebSocketRemoteTransport(`${options.controlUrl}#${options.pairingToken}`),
		{
			role: "desktop",
			deviceId,
			deviceName: hostname(),
			capabilities: { chat: true, sessionRead: true },
			logger: {
				debug: (message: string, metadata) => log.debug(message, metadata),
				info: (message: string, metadata) => log.info(message, metadata),
				warn: (message: string, metadata) => log.warn(message, metadata),
			},
		},
	);
	const operations = new DesktopConversationRemoteOperations(getDesktopConversationService(), {
		cwd: options.conversationCwd,
	});
	const connector = new DesktopRemoteConnector(connection, operations);
	const unsubscribe = connection.onEvent((event) => {
		if (event.type === "state" && event.state === "online") reconnectDelayMs = 1_000;
		if (event.type === "state" && (event.state === "reconnecting" || event.state === "failed")) {
			void scheduleReconnect(options, runGeneration);
		}
	});
	active = { connector, unsubscribe };
	try {
		await connector.start();
		log.info("remote access connector started", { deviceId });
	} catch (error) {
		log.warn("remote access connection attempt failed", {
			error: error instanceof Error ? error.message : String(error),
		});
		await scheduleReconnect(options, runGeneration);
	}
}

async function scheduleReconnect(options: DesktopRemoteAccessOptions, runGeneration: number): Promise<void> {
	if (runGeneration !== generation || reconnectTimer) return;
	const current = active;
	active = undefined;
	current?.unsubscribe();
	if (current) await current.connector.stop().catch(() => undefined);
	const delayMs = reconnectDelayMs;
	reconnectDelayMs = Math.min(30_000, reconnectDelayMs * 2);
	reconnectTimer = setTimeout(() => {
		reconnectTimer = undefined;
		void connect(options, runGeneration);
	}, delayMs);
	reconnectTimer.unref?.();
	log.info("remote access reconnect scheduled", { delayMs });
}
