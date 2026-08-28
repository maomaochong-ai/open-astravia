import { stat } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import { CODING_AGENT_SESSION_TITLE_GENERATE } from "@vetta/coding-agent/session-extensions";
import {
	isSessionError,
	type PromptRequest,
	RUNTIME_ERROR_CODES,
	type RuntimeContextCompactionResult,
	type RuntimeFailure,
	type RuntimeHost,
	type RuntimeTurnPromptOutcome,
	runtimeFailureFromAIErrorDetails,
	type SessionEvent,
} from "@vetta/runtime-core";
import { sanitizeRuntimeErrorMessage } from "@vetta/runtime-desktop";
import { type DesktopSessionHistoryInfo, UNAVAILABLE_RUNTIME_SESSION_ACCESS } from "../../shared/session-access.js";
import { monitorRuntimeSession } from "../app-monitor/app-monitor-service.js";
import { allowProjectRoot, readDesktopConfig } from "../ipc/fs.js";
import { getAppLogger } from "../logger.js";
import { getSharedRuntime } from "../runtime.js";
import { assertSandboxAvailableForMode } from "../sandbox/capability.js";
import { emitConversationListChanged } from "./conversation-list-events.js";
import {
	type DesktopCodingAgentSessionConfig,
	type DesktopConversationSource,
	type DesktopSessionKind,
	resolveDesktopSessionConfig,
} from "./resolve-session-config.js";
import { recordSessionAgentMode } from "./session-agent-mode-store.js";
import { DesktopSessionCreationTrace } from "./session-creation-trace.js";
import {
	isConversationCwd,
	readDesktopSessionHeader,
	resolveSessionDirForCwd,
	resolveSessionListCwd,
} from "./session-paths.js";

const log = getAppLogger("conversation-service");

export type DesktopConversationErrorCode =
	| "INVALID_SESSION_PATH"
	| "SESSION_NOT_FOUND"
	| "SESSION_BUSY"
	| "SESSION_LOCKED"
	| "SESSION_READ_ONLY"
	| "TURN_TIMEOUT"
	| "TURN_ABORTED"
	| "TURN_FAILED";

export class DesktopConversationError extends Error {
	constructor(
		readonly code: DesktopConversationErrorCode,
		message: string,
		readonly details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "DesktopConversationError";
	}
}

export interface DesktopConversationSession {
	sessionId: string;
	sessionPath: string;
	cwd: string;
	listCwd: string;
	source: DesktopConversationSource;
}

export interface DesktopConversationTurnResult {
	sessionId: string;
	sessionPath: string;
	cwd: string;
	status: "completed";
	stopReason: string;
	assistantText: string;
	messageCount: number;
}

export interface RunDesktopConversationTurnOptions {
	session: DesktopConversationSession;
	prompt: PromptRequest;
	/** null disables the wall-clock timeout for explicitly user-controlled remote turns. */
	timeoutMs: number | null;
	signal?: AbortSignal;
}

export interface DesktopConversationCreateTraceContext {
	readonly interactionId?: string;
}

function hasRuntimeErrorCode(error: unknown, code: string): boolean {
	return isSessionError(error) && error.code === code;
}

function findLastAssistantMessage(
	runtime: RuntimeHost,
	sessionId: string,
	fromIndex: number,
): {
	text: string;
	stopReason: string;
	errorMessage?: string;
	failure?: RuntimeFailure;
} | null {
	const messages = runtime.getMessages(sessionId);
	for (let index = messages.length - 1; index >= fromIndex; index -= 1) {
		const message = messages[index];
		if (message?.role !== "assistant") continue;
		const text = message.content
			.filter((item) => item.type === "text")
			.map((item) => item.text)
			.join("\n");
		return {
			text,
			stopReason: message.stopReason,
			errorMessage: message.errorMessage,
			...(message.failure ? { failure: runtimeFailureFromAIErrorDetails(message.failure) } : {}),
		};
	}
	return null;
}

export class DesktopConversationService {
	private readonly autoTitleScheduledSessions = new Set<string>();

	constructor(private readonly runtime: RuntimeHost) {}

	subscribe(sessionId: string, handler: (event: SessionEvent) => void): () => void {
		return this.runtime.subscribe(sessionId, handler);
	}

	async createSession(
		config: DesktopCodingAgentSessionConfig | undefined,
		kind: DesktopSessionKind,
		source: DesktopConversationSource,
		traceContext?: DesktopConversationCreateTraceContext,
	): Promise<DesktopConversationSession> {
		const trace = new DesktopSessionCreationTrace(log, traceContext?.interactionId);
		try {
			await trace.measure("sandbox-check", () =>
				assertSandboxAvailableForMode(config?.executionMode, async () => {
					const desktopConfig = await readDesktopConfig();
					return desktopConfig.defaultExecutionMode;
				}),
			);
			const resolvedConfig = await trace.measure("resolve-config", () =>
				resolveDesktopSessionConfig(config, kind, source),
			);
			const result = await trace.measure("runtime-create", () => this.runtime.createSession(resolvedConfig.config));
			const sessionPath = this.runtime.getSessionPath(result.sessionId);
			if (!sessionPath) {
				throw new DesktopConversationError("TURN_FAILED", "Runtime did not expose the created session path.");
			}
			// 工作模式在这里固化：新会话写入当前默认值，历史会话补写回落值。
			// 已有记录不覆盖，所以之后改默认值不会改写任何已存在会话。
			await trace.measure("record-agent-mode", () => recordSessionAgentMode(sessionPath, resolvedConfig.agentMode));
			monitorRuntimeSession(this.runtime, result.sessionId, "interactive");
			log.info("session created", {
				sessionId: result.sessionId,
				sessionPath,
				cwd: resolvedConfig.cwd,
				kind,
				source,
				scenario: resolvedConfig.scenario,
				includeAgentSkills: resolvedConfig.includeAgentSkills,
			});
			const session = {
				sessionId: result.sessionId,
				sessionPath,
				cwd: resolvedConfig.cwd,
				listCwd: resolveSessionListCwd(config?.cwd ?? resolvedConfig.cwd),
				source,
			};
			trace.complete({ sessionId: result.sessionId, kind, source });
			return session;
		} catch (error) {
			trace.fail({ kind, source });
			if (error instanceof DesktopConversationError) throw error;
			if (hasRuntimeErrorCode(error, RUNTIME_ERROR_CODES.SESSION_LOCKED)) {
				throw new DesktopConversationError("SESSION_LOCKED", "Session is locked by another process.");
			}
			if (hasRuntimeErrorCode(error, RUNTIME_ERROR_CODES.SESSION_BUSY)) {
				throw new DesktopConversationError("SESSION_BUSY", "Session is already processing another turn.");
			}
			throw error;
		}
	}

	async openSession(
		sessionPath: string,
		executionMode: "sandbox" | "full-access",
		source: DesktopConversationSource,
	): Promise<DesktopConversationSession> {
		if (!isAbsolute(sessionPath) || extname(sessionPath).toLowerCase() !== ".jsonl") {
			throw new DesktopConversationError("INVALID_SESSION_PATH", "sessionPath must be an absolute .jsonl path.");
		}
		const absolutePath = resolve(sessionPath);
		try {
			const file = await stat(absolutePath);
			if (!file.isFile()) {
				throw new DesktopConversationError("SESSION_NOT_FOUND", "Session path is not a file.", {
					sessionPath: absolutePath,
				});
			}
		} catch (error) {
			if (error instanceof DesktopConversationError) throw error;
			throw new DesktopConversationError("SESSION_NOT_FOUND", "Session file does not exist.", {
				sessionPath: absolutePath,
			});
		}
		const access = await this.runtime.resolveSessionAccess(absolutePath);
		if (!access) {
			throw new DesktopConversationError("INVALID_SESSION_PATH", "Session path is not owned by this runtime.", {
				sessionPath: absolutePath,
			});
		}
		if (!access.resume) {
			throw new DesktopConversationError("SESSION_READ_ONLY", "Session only supports read-only history access.", {
				sessionPath: absolutePath,
			});
		}
		const header = await readDesktopSessionHeader(absolutePath);
		if (!header) {
			throw new DesktopConversationError("INVALID_SESSION_PATH", "Session file has no valid Vetta session header.", {
				sessionPath: absolutePath,
			});
		}
		return this.createSession(
			{
				cwd: header.cwd,
				sessionPath: absolutePath,
				executionMode,
			},
			isConversationCwd(header.cwd) ? "conversation" : "other",
			source,
		);
	}

	async compactSessionContext(
		session: DesktopConversationSession,
		customInstructions?: string,
		signal?: AbortSignal,
	): Promise<RuntimeContextCompactionResult> {
		if (signal?.aborted) {
			throw new DesktopConversationError("TURN_ABORTED", "Context compaction was aborted before it started.");
		}
		const before = this.runtime.getState(session.sessionId);
		const onAbort = (): void => this.runtime.abortSessionContextCompaction(session.sessionId);
		signal?.addEventListener("abort", onAbort, { once: true });
		log.info("manual context compaction started", {
			sessionId: session.sessionId,
			sessionPath: session.sessionPath,
			contextTokens: before.contextTokens,
			contextWindow: before.contextWindow,
			hasCustomInstructions: customInstructions !== undefined,
		});
		try {
			const result = await this.runtime.compactSessionContext(
				session.sessionId,
				customInstructions === undefined ? undefined : { customInstructions },
			);
			log.info("manual context compaction completed", {
				sessionId: session.sessionId,
				tokensBefore: result.tokensBefore,
				summaryChars: result.summary.length,
				firstKeptEntryId: result.firstKeptEntryId,
			});
			emitConversationListChanged({ cwd: session.listCwd, sessionPath: session.sessionPath });
			return result;
		} catch (error) {
			const message = sanitizeRuntimeErrorMessage(error instanceof Error ? error.message : String(error));
			log.warn("manual context compaction failed", {
				sessionId: session.sessionId,
				message,
			});
			if (signal?.aborted) {
				throw new DesktopConversationError("TURN_ABORTED", "Context compaction was aborted.");
			}
			if (hasRuntimeErrorCode(error, RUNTIME_ERROR_CODES.SESSION_BUSY)) {
				throw new DesktopConversationError("SESSION_BUSY", "Session context compaction is already running.");
			}
			throw new DesktopConversationError("TURN_FAILED", message);
		} finally {
			signal?.removeEventListener("abort", onAbort);
		}
	}

	async listSessions(cwd: string): Promise<DesktopSessionHistoryInfo[]> {
		if (!isAbsolute(cwd)) {
			throw new DesktopConversationError("INVALID_SESSION_PATH", "cwd must be an absolute path.");
		}
		const absoluteCwd = resolve(cwd);
		allowProjectRoot(absoluteCwd);
		const sessions = await this.runtime.listSessions(absoluteCwd, resolveSessionDirForCwd(absoluteCwd));
		return Promise.all(
			sessions.map(async (session) => ({
				...session,
				access: (await this.runtime.resolveSessionAccess(session.path)) ?? UNAVAILABLE_RUNTIME_SESSION_ACCESS,
			})),
		);
	}

	async promptInteractiveSession(
		sessionId: string,
		prompt: PromptRequest,
		cwd?: string,
	): Promise<RuntimeTurnPromptOutcome> {
		return this.promptWithAutoTitle(
			{
				sessionId,
				sessionPath: this.runtime.getSessionPath(sessionId),
				listCwd: cwd ? resolveSessionListCwd(cwd) : undefined,
			},
			prompt,
		);
	}

	private async promptWithAutoTitle(
		session: { sessionId: string; sessionPath?: string; listCwd?: string },
		prompt: PromptRequest,
	): Promise<RuntimeTurnPromptOutcome> {
		const shouldSchedule =
			prompt.text.trim().length > 0 &&
			this.runtime.getMessages(session.sessionId).length === 0 &&
			!this.autoTitleScheduledSessions.has(session.sessionId);
		let autoTitleStarted = false;
		let unsubscribe: (() => void) | undefined;

		if (shouldSchedule) {
			this.autoTitleScheduledSessions.add(session.sessionId);
			unsubscribe = this.runtime.subscribe(session.sessionId, (event) => {
				if (event.type !== "session.lifecycle" || event.phase !== "agent_start") return;
				autoTitleStarted = true;
				unsubscribe?.();
				unsubscribe = undefined;
				void this.runtime
					.invokeSessionExtension(session.sessionId, CODING_AGENT_SESSION_TITLE_GENERATE, {
						userText: prompt.text,
						assistantText: "",
					})
					.then(async (name) => {
						if (!name || !session.sessionPath || !session.listCwd) return;
						await this.runtime.renameSessionById(session.sessionId, name);
						emitConversationListChanged({
							cwd: session.listCwd,
							sessionPath: session.sessionPath,
						});
					})
					.catch((error) => log.warn("conversation auto-title failed", error));
			});
		}

		try {
			return await this.runtime.prompt(session.sessionId, prompt);
		} finally {
			unsubscribe?.();
			if (shouldSchedule && !autoTitleStarted) {
				this.autoTitleScheduledSessions.delete(session.sessionId);
			}
		}
	}

	async runTurn(options: RunDesktopConversationTurnOptions): Promise<DesktopConversationTurnResult> {
		if (this.runtime.getState(options.session.sessionId).isStreaming) {
			throw new DesktopConversationError("SESSION_BUSY", "Session is already processing another turn.", {
				sessionPath: options.session.sessionPath,
			});
		}
		if (options.signal?.aborted) {
			throw new DesktopConversationError("TURN_ABORTED", "Conversation turn was aborted before it started.");
		}
		const initialMessageCount = this.runtime.getMessages(options.session.sessionId).length;
		emitConversationListChanged({
			cwd: options.session.listCwd,
			sessionPath: options.session.sessionPath,
			...(initialMessageCount === 0
				? {
						session: {
							id: options.session.sessionId,
							cwd: options.session.cwd,
							firstMessage: options.prompt.text,
							modifiedAt: Date.now(),
						},
					}
				: {}),
		});

		let cancellationStarted = false;
		let rejectCancellation: ((error: DesktopConversationError) => void) | undefined;
		const cancellation = new Promise<never>((_resolve, reject) => {
			rejectCancellation = reject;
		});
		const cancel = (code: "TURN_TIMEOUT" | "TURN_ABORTED", message: string): void => {
			if (cancellationStarted) return;
			cancellationStarted = true;
			void this.runtime
				.abort(options.session.sessionId)
				.catch((error) => log.warn("failed to abort conversation turn", error))
				.finally(() => rejectCancellation?.(new DesktopConversationError(code, message)));
		};
		const onAbort = (): void => cancel("TURN_ABORTED", "Conversation turn was aborted by the caller.");
		options.signal?.addEventListener("abort", onAbort, { once: true });
		const timeout =
			options.timeoutMs === null
				? undefined
				: setTimeout(
						() => cancel("TURN_TIMEOUT", `Conversation turn exceeded ${options.timeoutMs}ms.`),
						options.timeoutMs,
					);

		try {
			await Promise.race([
				options.session.source === "debug"
					? this.promptWithAutoTitle(options.session, options.prompt)
					: this.runtime.prompt(options.session.sessionId, options.prompt),
				cancellation,
			]);
		} catch (error) {
			emitConversationListChanged({
				cwd: options.session.listCwd,
				sessionPath: options.session.sessionPath,
			});
			if (error instanceof DesktopConversationError) throw error;
			if (hasRuntimeErrorCode(error, RUNTIME_ERROR_CODES.SESSION_BUSY)) {
				throw new DesktopConversationError("SESSION_BUSY", "Session is already processing another turn.");
			}
			if (isSessionError(error)) {
				throw new DesktopConversationError("TURN_FAILED", error.message, {
					code: error.code,
					retryable: error.retryable,
					origin: error.origin,
					details: error.details,
				});
			}
			throw new DesktopConversationError("TURN_FAILED", error instanceof Error ? error.message : String(error));
		} finally {
			if (timeout !== undefined) clearTimeout(timeout);
			options.signal?.removeEventListener("abort", onAbort);
		}

		const assistant = findLastAssistantMessage(this.runtime, options.session.sessionId, initialMessageCount);
		if (!assistant) {
			throw new DesktopConversationError("TURN_FAILED", "Conversation turn completed without an assistant message.");
		}
		if (assistant.stopReason === "aborted") {
			throw new DesktopConversationError("TURN_ABORTED", "Conversation turn was aborted.");
		}
		if (assistant.stopReason === "error") {
			throw new DesktopConversationError(
				"TURN_FAILED",
				assistant.errorMessage ?? assistant.failure?.message ?? "Conversation turn failed.",
				assistant.failure
					? {
							code: assistant.failure.code,
							retryable: assistant.failure.retryable,
							origin: assistant.failure.origin,
							details: assistant.failure.details,
						}
					: undefined,
			);
		}
		emitConversationListChanged({ cwd: options.session.listCwd, sessionPath: options.session.sessionPath });
		return {
			sessionId: options.session.sessionId,
			sessionPath: options.session.sessionPath,
			cwd: options.session.cwd,
			status: "completed",
			stopReason: assistant.stopReason,
			assistantText: assistant.text,
			messageCount: this.runtime.getState(options.session.sessionId).messageCount,
		};
	}
}

let sharedService: DesktopConversationService | undefined;

export function getDesktopConversationService(): DesktopConversationService {
	if (!sharedService) {
		sharedService = new DesktopConversationService(getSharedRuntime());
	}
	return sharedService;
}
