import { stat } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import type {
	PromptRequest,
	RuntimeHost,
	SessionConfig,
	SessionHistoryInfo,
} from "../../../../runtime-core/src/index.js";
import { catalogFamilyOfType } from "../../preload/api-types/database.js";
import { monitorRuntimeSession } from "../app-monitor/app-monitor-service.js";
import { databaseService, isConnectionAiAccessEnabled } from "../database/database-service.js";
import { allowProjectRoot, readDesktopConfig } from "../ipc/fs.js";
import { getAppLogger } from "../logger.js";
import { getSharedRuntime } from "../runtime.js";
import { assertSandboxAvailableForMode } from "../sandbox/capability.js";
import { emitConversationListChanged } from "./conversation-list-events.js";
import {
	DB_AI_PER_MESSAGE_ANTI_LOOP,
	type DbMentionRef,
	extractDbMentions,
	formatMentionedTableSchema,
} from "./db-mention-schema.js";
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

function isSessionLockError(error: unknown): boolean {
	return error instanceof Error && error.name === "SessionLockError";
}

function isBusyError(error: unknown): boolean {
	return error instanceof Error && error.message.includes("Agent is already processing");
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
			if (isSessionLockError(error)) {
				throw new DesktopConversationError("SESSION_LOCKED", "Session is locked by another process.");
			}
			if (isBusyError(error)) {
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
		const header = await readDesktopSessionHeader(absolutePath);
		if (!header) {
			throw new DesktopConversationError(
				"INVALID_SESSION_PATH",
				"Session file has no valid Astravia session header.",
				{
					sessionPath: absolutePath,
				},
			);
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

	async listSessions(cwd: string): Promise<SessionHistoryInfo[]> {
		if (!isAbsolute(cwd)) {
			throw new DesktopConversationError("INVALID_SESSION_PATH", "cwd must be an absolute path.");
		}
		const absoluteCwd = resolve(cwd);
		allowProjectRoot(absoluteCwd);
		return this.runtime.listSessions(absoluteCwd, resolveSessionDirForCwd(absoluteCwd));
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

		// ─── Per-message @connection.table mention schema 注入 ───
		// renderer 在 metadata.databaseMentions 里传递本轮 @mention 列表。
		// 这里在发给 runtime 前拉取各表 schema，拼成隐藏上下文追加到 prompt text。
		// 与 resolve-session-config 里的会话级 buildDatabaseSchemaPrompt 互补：
		// scope 管持久背景（system prompt），mention 管本轮对话意图。
		const mentions = extractDbMentions(options.prompt.metadata);
		let effectivePrompt = options.prompt;
		if (mentions.length > 0) {
			const schemaBlocks = await buildMentionedTableSchemaBlocks(mentions);
			if (schemaBlocks.length > 0) {
				// 🛡️ 附带反循环指令——引用 DB_AI_PER_MESSAGE_ANTI_LOOP 常量，避免与 system prompt 版本漂移
				effectivePrompt = {
					...options.prompt,
					text: `${options.prompt.text}\n\n${schemaBlocks.join("\n\n")}\n\n${DB_AI_PER_MESSAGE_ANTI_LOOP}`,
				};
			}
		}

		try {
			await Promise.race([this.runtime.prompt(options.session.sessionId, effectivePrompt), cancellation]);
		} catch (error) {
			emitConversationListChanged({
				cwd: options.session.listCwd,
				sessionPath: options.session.sessionPath,
			});
			if (error instanceof DesktopConversationError) throw error;
			if (isBusyError(error)) {
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

// ─── Per-message @mention schema 注入辅助函数 ───

/** 拉取所有 @mention 表的 schema，跳过被 AI access guard 拒绝的连接，并行拉取 */
async function buildMentionedTableSchemaBlocks(mentions: DbMentionRef[]): Promise<string[]> {
	// 先过 guard：白名单外的连接直接跳过（不浪费 IPC）
	const allowed = mentions.filter((m) => {
		if (!isConnectionAiAccessEnabled(m.connection)) {
			log.info(`[@mention] 跳过连接「${m.connection}」的表「${m.table}」——AI 访问未授权`);
			return false;
		}
		return true;
	});
	if (allowed.length === 0) return [];

	// 预取连接列表以推断每个 connection 的 catalog family（scope kind）
	let connectionTypes: Map<string, string> | null = null;
	try {
		const conns = await databaseService.listConnections();
		if (conns.ok) {
			connectionTypes = new Map(conns.data.map((c) => [c.name, c.type]));
		}
	} catch {
		// listConnections 失败——仍尝试拉 schema（如果 mention 带了 scope 会透传），
		// 只是无法判断引擎 family，scope 同时塞入 schema 和 database 让 describeTable 自行选择。
		log.warn("[@mention] listConnections 失败，将以退化模式拉 schema（scope 同时塞 schema + database）");
	}

	// 并行拉取所有 schema——describeTable 慢不阻塞发送
	const settled = await Promise.allSettled(
		allowed.map(async (m) => {
			// 根据 connection type + scope 构造 DbTableScope。
			// 注意：connectionTypes 可能为 null（listConnections 失败），
			// 此时我们不知道引擎是 flat 还是 PG/MySQL——但用户显式给了 m.scope 时
			// 仍然透传下去（describeTable 自己能按引擎默认处理多余的字段），
			// 不应该把用户信息丢掉。
			let scope: { schema?: string; database?: string } | undefined;
			if (connectionTypes) {
				const connType = connectionTypes.get(m.connection);
				if (connType) {
					const family = catalogFamilyOfType(connType);
					if (family !== "flat") {
						if (!m.scope) {
							// Bug 5: 非 flat 类型（PG/MySQL）但没传 scope → 描述表会用引擎默认
							// scope（PG 默认 public / MySQL 默认连接当前库），可能拉错表结构。
							// 显式跳过并 warn，比 silently 给用户错 schema 好。
							log.warn(
								`[@mention] 跳过 ${m.connection}.${m.table}——${family} 类型需要 scope，但 mention 里没带。` +
									`请用 @conn.schema.table 格式。`,
							);
							return null;
						}
						scope = family === "schemas" ? { schema: m.scope } : { database: m.scope };
					}
				}
			} else if (m.scope) {
				// listConnections 失败 — 退化：同时塞 schema 和 database，
				// 让 describeTable 按引擎自己的规则忽略多余字段。
				// 总比丢掉用户显式给的 scope 信息好。
				scope = { schema: m.scope, database: m.scope };
			}
			const result = await databaseService.describeTable(m.connection, m.table, scope);
			if (!result.ok) {
				log.warn(
					`[@mention] describeTable 失败：${m.connection}${m.scope ? `.${m.scope}` : ""}.${m.table} → ${result.error.code}`,
				);
				return null;
			}
			if (result.data.length === 0) {
				log.warn(`[@mention] describeTable 返回空列：${m.connection}${m.scope ? `.${m.scope}` : ""}.${m.table}`);
				return null;
			}
			return formatMentionedTableSchema(m.connection, m.table, result.data, m.scope);
		}),
	);

	const blocks: string[] = [];
	for (let i = 0; i < settled.length; i++) {
		const r = settled[i];
		if (r.status === "rejected") {
			log.warn(
				`[@mention] describeTable 异常：${allowed[i].connection}.${allowed[i].table} → ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
			);
			continue;
		}
		if (r.value) blocks.push(r.value);
	}
	return blocks;
}
