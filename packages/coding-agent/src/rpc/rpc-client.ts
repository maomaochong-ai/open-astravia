/**
 * RPC Client for programmatic access to the coding agent.
 *
 * Provides a typed API over an injected RPC transport.
 */

import type { AgentEvent, AgentMessage, ThinkingLevel } from "@vetta/agent-core";
import type { ImageContent } from "@vetta/ai";
import { RpcClientError, rpcClientErrorFromResponse } from "./rpc-client-error.js";
import { RPC_FAILURE_CODES } from "./rpc-failure.js";
import type {
	RpcBashResult,
	RpcCommand,
	RpcResponse,
	RpcSessionState,
	RpcSlashCommand,
	SessionStats,
} from "./rpc-types.js";

type RpcCompactionResult = Extract<RpcResponse, { command: "compact"; success: true }>["data"];

const RPC_CLIENT_REQUEST_TIMEOUT_MS = 30_000;
const RPC_CLIENT_EVENT_TIMEOUT_MS = 60_000;

// ============================================================================
// Types
// ============================================================================

/** Distributive Omit that works with union types */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** RpcCommand without the id field (for internal send) */
type RpcCommandBody = DistributiveOmit<RpcCommand, "id">;

export interface ModelInfo {
	provider: string;
	id: string;
	contextWindow: number;
	reasoning: boolean;
}

export type RpcEventListener = (event: AgentEvent) => void;

type RpcTransportFailureListener = (error: RpcClientError) => void;

export interface RpcClientTransportHandlers {
	readonly onLine: (line: string) => void;
	readonly onFailure: (error: RpcClientError) => void;
}

export interface RpcClientTransport {
	start(handlers: RpcClientTransportHandlers): Promise<void>;
	stop(): Promise<void>;
	write(line: string): void;
	getStderr(): string;
}

// ============================================================================
// RPC Client
// ============================================================================

export class RpcClient {
	private eventListeners: RpcEventListener[] = [];
	private pendingRequests: Map<string, { resolve: (response: RpcResponse) => void; reject: (error: Error) => void }> =
		new Map();
	private requestId = 0;
	private startupFailure: Extract<RpcResponse, { success: false }> | undefined;
	private transportFailure: RpcClientError | undefined;
	private transportFailureListeners = new Set<RpcTransportFailureListener>();
	private started = false;
	private starting = false;

	constructor(private readonly transport: RpcClientTransport) {}

	/**
	 * Start the configured RPC transport.
	 */
	async start(): Promise<void> {
		if (this.started || this.starting) {
			throw new RpcClientError("Client already started", {
				errorCode: RPC_FAILURE_CODES.INVALID_REQUEST,
				phase: "startup",
				recoverability: "user_action",
			});
		}
		this.startupFailure = undefined;
		this.transportFailure = undefined;
		this.starting = true;
		try {
			await this.transport.start({
				onLine: (line) => this.handleLine(line),
				onFailure: (error) => this.handleTransportFailure(error),
			});
		} finally {
			this.starting = false;
		}

		const transportFailure = this.readTransportFailure();
		if (transportFailure) {
			const failure = this.startupFailure
				? rpcClientErrorFromResponse(this.startupFailure)
				: new RpcClientError(
						transportFailure.message,
						{
							errorCode: transportFailure.errorCode,
							phase: "startup",
							recoverability: "retry_safe",
						},
						{ cause: transportFailure },
					);
			throw failure;
		}
		this.started = true;
	}

	/**
	 * Stop the configured RPC transport.
	 */
	async stop(): Promise<void> {
		if (!this.started && !this.starting) return;
		await this.transport.stop();
		this.started = false;
		this.starting = false;
		this.pendingRequests.clear();
	}

	/**
	 * Subscribe to agent events.
	 */
	onEvent(listener: RpcEventListener): () => void {
		this.eventListeners.push(listener);
		return () => {
			const index = this.eventListeners.indexOf(listener);
			if (index !== -1) {
				this.eventListeners.splice(index, 1);
			}
		};
	}

	/**
	 * Get collected stderr output (useful for debugging).
	 */
	getStderr(): string {
		return this.transport.getStderr();
	}

	// =========================================================================
	// Command Methods
	// =========================================================================

	/**
	 * Send a prompt to the agent.
	 * Returns immediately after sending; use onEvent() to receive streaming events.
	 * Use waitForIdle() to wait for completion.
	 */
	async prompt(message: string, images?: ImageContent[]): Promise<void> {
		await this.send({ type: "prompt", message, images });
	}

	/**
	 * Queue a steering message to interrupt the agent mid-run.
	 */
	async steer(message: string, images?: ImageContent[]): Promise<void> {
		await this.send({ type: "steer", message, images });
	}

	/**
	 * Queue a follow-up message to be processed after the agent finishes.
	 */
	async followUp(message: string, images?: ImageContent[]): Promise<void> {
		await this.send({ type: "follow_up", message, images });
	}

	/**
	 * Abort current operation.
	 */
	async abort(): Promise<void> {
		await this.send({ type: "abort" });
	}

	/**
	 * Start a new session, optionally with parent tracking.
	 * @param parentSession - Optional parent session path for lineage tracking
	 * @returns Object with `cancelled: true` if an extension cancelled the new session
	 */
	async newSession(parentSession?: string): Promise<{ cancelled: boolean }> {
		const response = await this.send({ type: "new_session", parentSession });
		return this.getData(response);
	}

	/**
	 * Get current session state.
	 */
	async getState(): Promise<RpcSessionState> {
		const response = await this.send({ type: "get_state" });
		return this.getData(response);
	}

	/**
	 * Set model by provider and ID.
	 */
	async setModel(provider: string, modelId: string): Promise<{ provider: string; id: string }> {
		const response = await this.send({ type: "set_model", provider, modelId });
		return this.getData(response);
	}

	/**
	 * Cycle to next model.
	 */
	async cycleModel(): Promise<{
		model: { provider: string; id: string };
		thinkingLevel: ThinkingLevel;
		isScoped: boolean;
	} | null> {
		const response = await this.send({ type: "cycle_model" });
		return this.getData(response);
	}

	/**
	 * Get list of available models.
	 */
	async getAvailableModels(): Promise<ModelInfo[]> {
		const response = await this.send({ type: "get_available_models" });
		return this.getData<{ models: ModelInfo[] }>(response).models;
	}

	/**
	 * Set thinking level.
	 */
	async setThinkingLevel(level: ThinkingLevel): Promise<void> {
		await this.send({ type: "set_thinking_level", level });
	}

	/**
	 * Cycle thinking level.
	 */
	async cycleThinkingLevel(): Promise<{ level: ThinkingLevel } | null> {
		const response = await this.send({ type: "cycle_thinking_level" });
		return this.getData(response);
	}

	/**
	 * Set steering mode.
	 */
	async setSteeringMode(mode: "all" | "one-at-a-time"): Promise<void> {
		await this.send({ type: "set_steering_mode", mode });
	}

	/**
	 * Set follow-up mode.
	 */
	async setFollowUpMode(mode: "all" | "one-at-a-time"): Promise<void> {
		await this.send({ type: "set_follow_up_mode", mode });
	}

	/**
	 * Compact session context.
	 */
	async compact(customInstructions?: string): Promise<RpcCompactionResult> {
		const response = await this.send({ type: "compact", customInstructions });
		return this.getData(response);
	}

	/**
	 * Set auto-compaction enabled/disabled.
	 */
	async setAutoCompaction(enabled: boolean): Promise<void> {
		await this.send({ type: "set_auto_compaction", enabled });
	}

	/**
	 * Set auto-retry enabled/disabled.
	 */
	async setAutoRetry(enabled: boolean): Promise<void> {
		await this.send({ type: "set_auto_retry", enabled });
	}

	/**
	 * Abort in-progress retry.
	 */
	async abortRetry(): Promise<void> {
		await this.send({ type: "abort_retry" });
	}

	/**
	 * Execute a bash command.
	 */
	async bash(command: string): Promise<RpcBashResult> {
		const response = await this.send({ type: "bash", command });
		return this.getData(response);
	}

	/**
	 * Abort running bash command.
	 */
	async abortBash(): Promise<void> {
		await this.send({ type: "abort_bash" });
	}

	/**
	 * Get session statistics.
	 */
	async getSessionStats(): Promise<SessionStats> {
		const response = await this.send({ type: "get_session_stats" });
		return this.getData(response);
	}

	/**
	 * Export session to HTML.
	 */
	async exportHtml(outputPath?: string): Promise<{ path: string }> {
		const response = await this.send({ type: "export_html", outputPath });
		return this.getData(response);
	}

	/**
	 * Switch to a different session file.
	 * @returns Object with `cancelled: true` if an extension cancelled the switch
	 */
	async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
		const response = await this.send({ type: "switch_session", sessionPath });
		return this.getData(response);
	}

	/**
	 * Fork from a specific message.
	 * @returns Object with `text` (the message text) and `cancelled` (if extension cancelled)
	 */
	async fork(entryId: string): Promise<{ text: string; cancelled: boolean }> {
		const response = await this.send({ type: "fork", entryId });
		return this.getData(response);
	}

	/**
	 * Get messages available for forking.
	 */
	async getForkMessages(): Promise<Array<{ entryId: string; text: string }>> {
		const response = await this.send({ type: "get_fork_messages" });
		return this.getData<{ messages: Array<{ entryId: string; text: string }> }>(response).messages;
	}

	/**
	 * Get text of last assistant message.
	 */
	async getLastAssistantText(): Promise<string | null> {
		const response = await this.send({ type: "get_last_assistant_text" });
		return this.getData<{ text: string | null }>(response).text;
	}

	/**
	 * Set the session display name.
	 */
	async setSessionName(name: string): Promise<void> {
		await this.send({ type: "set_session_name", name });
	}

	/**
	 * Get all messages in the session.
	 */
	async getMessages(): Promise<AgentMessage[]> {
		const response = await this.send({ type: "get_messages" });
		return this.getData<{ messages: AgentMessage[] }>(response).messages;
	}

	/**
	 * Get available commands (extension commands, prompt templates, skills).
	 */
	async getCommands(): Promise<RpcSlashCommand[]> {
		const response = await this.send({ type: "get_commands" });
		return this.getData<{ commands: RpcSlashCommand[] }>(response).commands;
	}

	// =========================================================================
	// Helpers
	// =========================================================================

	/**
	 * Wait for agent to become idle (no streaming).
	 * Resolves when agent_end event is received.
	 */
	waitForIdle(timeout = RPC_CLIENT_EVENT_TIMEOUT_MS): Promise<void> {
		return new Promise((resolve, reject) => {
			let unsubscribeEvent = (): void => {};
			let unsubscribeFailure = (): void => {};
			const cleanup = (): void => {
				clearTimeout(timer);
				unsubscribeEvent();
				unsubscribeFailure();
			};
			const timer = setTimeout(() => {
				cleanup();
				reject(
					new RpcClientError(`Timeout waiting for agent to become idle. Stderr: ${this.getStderr()}`, {
						errorCode: RPC_FAILURE_CODES.REQUEST_TIMEOUT,
						phase: "turn",
						recoverability: "continue_session",
					}),
				);
			}, timeout);

			unsubscribeEvent = this.onEvent((event) => {
				if (event.type === "agent_end") {
					cleanup();
					resolve();
				}
			});
			unsubscribeFailure = this.onTransportFailure((error) => {
				cleanup();
				reject(turnProcessFailure(error));
			});
		});
	}

	/**
	 * Collect events until agent becomes idle.
	 */
	collectEvents(timeout = RPC_CLIENT_EVENT_TIMEOUT_MS): Promise<AgentEvent[]> {
		return new Promise((resolve, reject) => {
			const events: AgentEvent[] = [];
			let unsubscribeEvent = (): void => {};
			let unsubscribeFailure = (): void => {};
			const cleanup = (): void => {
				clearTimeout(timer);
				unsubscribeEvent();
				unsubscribeFailure();
			};
			const timer = setTimeout(() => {
				cleanup();
				reject(
					new RpcClientError(`Timeout collecting events. Stderr: ${this.getStderr()}`, {
						errorCode: RPC_FAILURE_CODES.REQUEST_TIMEOUT,
						phase: "turn",
						recoverability: "continue_session",
					}),
				);
			}, timeout);

			unsubscribeEvent = this.onEvent((event) => {
				events.push(event);
				if (event.type === "agent_end") {
					cleanup();
					resolve(events);
				}
			});
			unsubscribeFailure = this.onTransportFailure((error) => {
				cleanup();
				reject(turnProcessFailure(error));
			});
		});
	}

	/**
	 * Send prompt and wait for completion, returning all events.
	 */
	async promptAndWait(
		message: string,
		images?: ImageContent[],
		timeout = RPC_CLIENT_EVENT_TIMEOUT_MS,
	): Promise<AgentEvent[]> {
		const eventsPromise = this.collectEvents(timeout);
		await this.prompt(message, images);
		return eventsPromise;
	}

	// =========================================================================
	// Internal
	// =========================================================================

	private handleLine(line: string): void {
		try {
			const data = JSON.parse(line);
			if (data.type === "response" && data.command === "startup" && data.success === false) {
				this.startupFailure = data as Extract<RpcResponse, { success: false }>;
			}

			// Check if it's a response to a pending request
			if (data.type === "response" && data.id && this.pendingRequests.has(data.id)) {
				const pending = this.pendingRequests.get(data.id)!;
				this.pendingRequests.delete(data.id);
				pending.resolve(data as RpcResponse);
				return;
			}

			// Otherwise it's an event
			for (const listener of this.eventListeners) {
				listener(data as AgentEvent);
			}
		} catch {
			// Ignore non-JSON lines
		}
	}

	private async send(command: RpcCommandBody): Promise<RpcResponse> {
		if (!this.started) {
			throw new RpcClientError("Client not started", {
				errorCode: RPC_FAILURE_CODES.CLIENT_NOT_STARTED,
				phase: "command",
				recoverability: "user_action",
			});
		}

		const id = `req_${++this.requestId}`;
		const fullCommand = { ...command, id } as RpcCommand;

		return new Promise((resolve, reject) => {
			this.pendingRequests.set(id, { resolve, reject });

			const timeout = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(
					new RpcClientError(
						`Timeout waiting for response to ${command.type}. Stderr: ${this.getStderr()}`,
						{
							errorCode: RPC_FAILURE_CODES.REQUEST_TIMEOUT,
							phase: "command",
							recoverability: "continue_session",
						},
						{ command: command.type },
					),
				);
			}, RPC_CLIENT_REQUEST_TIMEOUT_MS);

			this.pendingRequests.set(id, {
				resolve: (response) => {
					clearTimeout(timeout);
					if (!response.success) {
						reject(rpcClientErrorFromResponse(response));
						return;
					}
					resolve(response);
				},
				reject: (error) => {
					clearTimeout(timeout);
					reject(error);
				},
			});

			try {
				this.transport.write(`${JSON.stringify(fullCommand)}\n`);
			} catch (error) {
				clearTimeout(timeout);
				this.pendingRequests.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	private getData<T>(response: RpcResponse): T {
		if (!response.success) {
			const errorResponse = response as Extract<RpcResponse, { success: false }>;
			throw rpcClientErrorFromResponse(errorResponse);
		}
		// Type assertion: we trust response.data matches T based on the command sent.
		// This is safe because each public method specifies the correct T for its command.
		const successResponse = response as Extract<RpcResponse, { success: true; data: unknown }>;
		return successResponse.data as T;
	}

	private rejectPending(error: Error): void {
		for (const pending of this.pendingRequests.values()) pending.reject(error);
		this.pendingRequests.clear();
	}

	private handleTransportFailure(error: RpcClientError): void {
		this.started = false;
		this.rejectPending(error);
		this.transportFailure = error;
		for (const listener of this.transportFailureListeners) listener(error);
	}

	private readTransportFailure(): RpcClientError | undefined {
		return this.transportFailure;
	}

	private onTransportFailure(listener: RpcTransportFailureListener): () => void {
		if (this.transportFailure) {
			listener(this.transportFailure);
			return () => {};
		}
		this.transportFailureListeners.add(listener);
		return () => this.transportFailureListeners.delete(listener);
	}
}

function turnProcessFailure(error: RpcClientError): RpcClientError {
	return new RpcClientError(
		error.message,
		{
			errorCode: error.errorCode,
			phase: "turn",
			recoverability: error.recoverability,
		},
		{ cause: error },
	);
}
