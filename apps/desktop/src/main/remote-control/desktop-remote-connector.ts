import type { RemoteConnection, RemoteError, RemoteRequest } from "@vetta/remote-control";

export interface DesktopRemoteSessionSummary {
	readonly id: string;
	readonly title?: string;
	readonly updatedAtEpochMs?: number;
}

export interface DesktopRemotePromptEvent {
	readonly type: "delta" | "tool" | "state";
	readonly text?: string;
	readonly payload?: unknown;
}

export interface DesktopRemoteOperations {
	listSessions(): Promise<readonly DesktopRemoteSessionSummary[]>;
	createSession(): Promise<{ sessionId: string }>;
	openSession(sessionId: string): Promise<{ sessionId: string }>;
	prompt(sessionId: string, text: string): AsyncIterable<DesktopRemotePromptEvent>;
	abort(sessionId: string): Promise<void>;
	resume(sessionId: string, lastEventSequence: number): Promise<void>;
	diagnostics(): Promise<Record<string, unknown>>;
}

export class DesktopRemoteConnector {
	private unsubscribe: (() => void) | undefined;

	constructor(
		private readonly connection: RemoteConnection,
		private readonly operations: DesktopRemoteOperations,
	) {}

	async start(): Promise<void> {
		this.unsubscribe = this.connection.onEvent((event) => {
			if (event.type === "remote-request") void this.handleRequest(event.request);
		});
		await this.connection.connect();
	}

	async stop(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		await this.connection.close();
	}

	private async handleRequest(request: RemoteRequest): Promise<void> {
		try {
			const payload = await this.dispatch(request);
			await this.connection.respond(request.requestId, { success: true, payload });
		} catch (error) {
			await this.connection.respond(request.requestId, { success: false, error: toRemoteError(error) });
		}
	}

	private async dispatch(request: RemoteRequest): Promise<unknown> {
		switch (request.method) {
			case "session.list":
				return { sessions: await this.operations.listSessions() };
			case "session.open":
				return await this.operations.openSession(requireSessionId(request));
			case "session.prompt": {
				const sessionId = request.sessionId ?? (await this.operations.createSession()).sessionId;
				return await this.runPrompt(sessionId, readPromptText(request));
			}
			case "session.abort":
				await this.operations.abort(requireSessionId(request));
				return { aborted: true };
			case "session.resume":
				await this.operations.resume(requireSessionId(request), readSequence(request));
				return { resumed: true };
			case "diagnostics.snapshot":
				return await this.operations.diagnostics();
		}
	}

	private async runPrompt(sessionId: string, text: string): Promise<{ completed: true; sessionId: string }> {
		for await (const event of this.operations.prompt(sessionId, text)) {
			if (event.type === "delta" && event.text) {
				await this.connection.emitEvent("session.message", { kind: "delta", text: event.text }, sessionId);
				continue;
			}
			if (event.type === "tool") {
				await this.connection.emitEvent("session.tool", event.payload, sessionId);
				continue;
			}
			await this.connection.emitEvent("session.state", event.payload, sessionId);
		}
		return { completed: true, sessionId };
	}
}

function requireSessionId(request: RemoteRequest): string {
	if (!request.sessionId) throw new Error("sessionId is required");
	return request.sessionId;
}

function readPromptText(request: RemoteRequest): string {
	if (!isRecord(request.payload) || typeof request.payload.text !== "string" || !request.payload.text.trim()) {
		throw new Error("prompt payload text is required");
	}
	return request.payload.text;
}

function readSequence(request: RemoteRequest): number {
	if (!isRecord(request.payload) || typeof request.payload.lastEventSequence !== "number") {
		throw new Error("lastEventSequence is required");
	}
	return request.payload.lastEventSequence;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRemoteError(error: unknown): RemoteError {
	const message = error instanceof Error ? error.message : "Remote desktop operation failed";
	return {
		code: message.includes("required") ? "invalid_frame" : "internal_error",
		message: message.slice(0, 512),
		retryable: !message.includes("required"),
	};
}
