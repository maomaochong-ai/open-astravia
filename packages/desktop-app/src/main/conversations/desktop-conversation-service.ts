import { stat } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import {
	isSessionError,
	type PromptRequest,
	RUNTIME_ERROR_CODES,
	type RuntimeHost,
	type SessionConfig,
} from "@vetta/runtime-core";
import { type DesktopSessionHistoryInfo, UNAVAILABLE_RUNTIME_SESSION_ACCESS } from "../../shared/session-access.js";
import { monitorRuntimeSession } from "../app-monitor/app-monitor-service.js";
import { allowProjectRoot, readDesktopConfig } from "../ipc/fs.js";
import { getAppLogger } from "../logger.js";
import { getSharedRuntime } from "../runtime.js";
import { assertSandboxAvailableForMode } from "../sandbox/capability.js";
import { emitConversationListChanged } from "./conversation-list-events.js";
import {
	type DesktopConversationSource,
	type DesktopSessionKind,
	resolveDesktopSessionConfig,
} from "./resolve-session-config.js";
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
		readonly details?: Record<string, string | number | boolean>,
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
	timeoutMs: number;
	signal?: AbortSignal;
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
		};
	}
	return null;
}

export class DesktopConversationService {
	constructor(private readonly runtime: RuntimeHost) {}

	async createSession(
		config: SessionConfig | undefined,
		kind: DesktopSessionKind,
		source: DesktopConversationSource,
	): Promise<DesktopConversationSession> {
		await assertSandboxAvailableForMode(config?.executionMode, async () => {
			const desktopConfig = await readDesktopConfig();
			return desktopConfig.defaultExecutionMode;
		});
		const resolvedConfig = await resolveDesktopSessionConfig(config, kind, source);
		try {
			const result = await this.runtime.createSession(resolvedConfig.config);
			const sessionPath = this.runtime.getSessionPath(result.sessionId);
			if (!sessionPath) {
				throw new DesktopConversationError("TURN_FAILED", "Runtime did not expose the created session path.");
			}
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
			return session;
		} catch (error) {
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
		if (!access.interactiveResume) {
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
		const timeout = setTimeout(
			() => cancel("TURN_TIMEOUT", `Conversation turn exceeded ${options.timeoutMs}ms.`),
			options.timeoutMs,
		);

		try {
			await Promise.race([this.runtime.prompt(options.session.sessionId, options.prompt), cancellation]);
		} catch (error) {
			emitConversationListChanged({
				cwd: options.session.listCwd,
				sessionPath: options.session.sessionPath,
			});
			if (error instanceof DesktopConversationError) throw error;
			if (hasRuntimeErrorCode(error, RUNTIME_ERROR_CODES.SESSION_BUSY)) {
				throw new DesktopConversationError("SESSION_BUSY", "Session is already processing another turn.");
			}
			throw new DesktopConversationError("TURN_FAILED", error instanceof Error ? error.message : String(error));
		} finally {
			clearTimeout(timeout);
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
			throw new DesktopConversationError("TURN_FAILED", assistant.errorMessage ?? "Conversation turn failed.");
		}
		emitConversationListChanged({ cwd: options.session.listCwd, sessionPath: options.session.sessionPath });
		if (initialMessageCount === 0 && options.session.source === "debug" && assistant.text.trim().length > 0) {
			void this.runtime
				.autoTitleSession(options.session.sessionId, options.prompt.text, assistant.text)
				.then((name) => {
					if (!name) return;
					emitConversationListChanged({
						cwd: options.session.listCwd,
						sessionPath: options.session.sessionPath,
					});
				})
				.catch((error) => log.warn("conversation auto-title failed", error));
		}
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
