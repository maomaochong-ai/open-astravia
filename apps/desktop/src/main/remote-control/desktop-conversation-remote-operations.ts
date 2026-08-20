import { cpus, platform, release, totalmem } from "node:os";
import type {
	DesktopConversationService,
	DesktopConversationSession,
} from "../conversations/desktop-conversation-service.js";
import type {
	DesktopRemoteOperations,
	DesktopRemotePromptEvent,
	DesktopRemoteSessionSummary,
} from "./desktop-remote-connector.js";

interface ManagedSession {
	readonly session: DesktopConversationSession;
}

export interface DesktopConversationRemoteOperationsOptions {
	readonly cwd: string;
	readonly turnTimeoutMs?: number;
}

/**
 * Adapts the existing Desktop conversation ownership boundary to the remote protocol.
 * It keeps runtime session objects in process memory; only opaque IDs cross the relay.
 */
export class DesktopConversationRemoteOperations implements DesktopRemoteOperations {
	private readonly sessions = new Map<string, ManagedSession>();
	private readonly activeTurns = new Map<string, AbortController>();
	private readonly turnTimeoutMs: number;

	constructor(
		private readonly conversations: Pick<
			DesktopConversationService,
			"createSession" | "listSessions" | "openSession" | "runTurn"
		>,
		private readonly options: DesktopConversationRemoteOperationsOptions,
	) {
		this.turnTimeoutMs = options.turnTimeoutMs ?? 120_000;
	}

	async listSessions(): Promise<readonly DesktopRemoteSessionSummary[]> {
		const sessions = await this.conversations.listSessions(this.options.cwd);
		return sessions.map((session) => ({
			id: session.id,
			title: session.firstMessage,
			updatedAtEpochMs: session.modifiedAt,
		}));
	}

	async createSession(): Promise<{ sessionId: string }> {
		const session = await this.conversations.createSession({ cwd: this.options.cwd }, "conversation", "interactive");
		this.sessions.set(session.sessionId, { session });
		return { sessionId: session.sessionId };
	}

	async openSession(sessionId: string): Promise<{ sessionId: string }> {
		const known = this.sessions.get(sessionId);
		if (known) return { sessionId };
		const history = await this.conversations.listSessions(this.options.cwd);
		const record = history.find((session) => session.id === sessionId);
		if (!record) throw new Error("Desktop session was not found");
		const session = await this.conversations.openSession(record.path, "sandbox", "interactive");
		this.sessions.set(session.sessionId, { session });
		return { sessionId: session.sessionId };
	}

	async *prompt(sessionId: string, text: string): AsyncIterable<DesktopRemotePromptEvent> {
		const managed = this.sessions.get(sessionId);
		if (!managed) throw new Error("Desktop session must be opened before prompting");
		if (this.activeTurns.has(sessionId)) throw new Error("Desktop session is already processing a turn");
		const controller = new AbortController();
		this.activeTurns.set(sessionId, controller);
		yield { type: "state", payload: { state: "running" } };
		try {
			const result = await this.conversations.runTurn({
				session: managed.session,
				prompt: { text },
				timeoutMs: this.turnTimeoutMs,
				signal: controller.signal,
			});
			if (result.assistantText) yield { type: "delta", text: result.assistantText };
			yield { type: "state", payload: { state: result.status, stopReason: result.stopReason } };
		} finally {
			this.activeTurns.delete(sessionId);
		}
	}

	async abort(sessionId: string): Promise<void> {
		this.activeTurns.get(sessionId)?.abort();
	}

	async resume(_sessionId: string, _lastEventSequence: number): Promise<void> {
		// Connection-level event replay is handled by RemoteConnection's ACK buffer.
	}

	async diagnostics(): Promise<Record<string, unknown>> {
		return {
			activeSessionCount: this.sessions.size,
			cwd: this.options.cwd,
			osLabel: formatOsLabel(),
			cpu: cpus()[0]?.model,
			ram: formatMemory(totalmem()),
		};
	}
}

function formatMemory(bytes: number): string {
	const gigabytes = bytes / 1024 ** 3;
	if (gigabytes >= 1) return `${gigabytes.toFixed(1)} GB`;
	return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function formatOsLabel(): string {
	const version = release();
	let name: string;
	switch (platform()) {
		case "win32":
			name = "Windows";
			break;
		case "darwin":
			name = "macOS";
			break;
		case "linux":
			name = "Linux";
			break;
		default:
			name = platform();
	}
	return `${name} (${version})`;
}
