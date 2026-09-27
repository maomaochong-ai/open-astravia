import { createHash, randomBytes } from "node:crypto";
import type {
	BrowserActInput,
	BrowserNavigateInput,
	BrowserPageState,
	BrowserReadTextInput,
	BrowserRuntimeInstallInput,
	BrowserRuntimeStatus,
	BrowserScreenshotInput,
	BrowserSession,
	BrowserSessionCreateInput,
	BrowserSessionInput,
	BrowserSnapshotInput,
} from "@astravia/capability-sdk";
import { assertAllowedBrowserUrl, assertReturnedPageAllowed } from "./browser-policy.js";
import type { BrowserSessionRegistry } from "./browser-session-registry.js";
import type {
	BrowserAutomationLogger,
	BrowserEngine,
	BrowserProfilePort,
	BrowserRuntimePort,
	BrowserSessionRecord,
	SessionResources,
} from "./contracts.js";
import { BrowserAutomationError } from "./contracts.js";

const _REVISION_INJECTION_TARGET = "__ASTRAVIA_REVISION_MARKER__";

/** 生成可预测的 session suffix：优先用 workspace root 的 sha256[:16]，root 缺失才用 random。 */
function generateSessionId(root?: string): string {
	if (!root) return `astravia-${randomBytes(8).toString("hex")}`;
	const hash = createHash("sha256").update(root).digest("hex").slice(0, 16);
	return `astravia-${hash}`;
}

export interface BrowserAutomationServiceOptions {
	engine: BrowserEngine;
	runtime: BrowserRuntimePort;
	profiles: BrowserProfilePort;
	sessions: BrowserSessionRegistry;
	logger: BrowserAutomationLogger;
}

/**
 * 主进程浏览器自动化编排核心。
 * 负责：会话创建与关闭、操作编排、域名白名单、stale snapshot 防护、
 *       persistent profile 互斥锁、policy escape 强制关闭。
 */
export class BrowserAutomationService {
	private readonly records = new Map<string, BrowserSessionRecord>(); // key = namespace:sessionId

	constructor(private readonly options: BrowserAutomationServiceOptions) {}

	// ========== Runtime ==========

	runtimeStatus(signal?: AbortSignal): Promise<BrowserRuntimeStatus> {
		return this.options.runtime.status(signal);
	}

	installRuntime(input: BrowserRuntimeInstallInput, signal?: AbortSignal): Promise<BrowserRuntimeStatus> {
		return this.options.runtime.install(input, signal);
	}

	// ========== Session ==========

	async createSession(input: BrowserSessionCreateInput, signal?: AbortSignal): Promise<BrowserSession> {
		const sessionId = generateSessionId(input.namespace);
		const now = Date.now();
		const session: BrowserSession = {
			id: sessionId,
			source: input.source ?? "managed",
			profile: input.profile ?? { type: "ephemeral" },
			headed: input.headed ?? true,
			status: "ready",
			createdAt: now,
		};

		// persistent profile 互斥保护：同 profile.id 不能被两个会话同时占用
		if (session.profile.type === "persistent" && session.profile.id) {
			await this.options.sessions.runPersistentProfileExclusive(
				session.profile.id,
				input.namespace,
				session.id,
				async () => this.createSessionLocked(input, session, signal),
			);
		}

		return await this.createSessionLocked(input, session, signal);
	}

	private async createSessionLocked(
		input: BrowserSessionCreateInput,
		session: BrowserSession,
		_signal?: AbortSignal,
	): Promise<BrowserSession> {
		const resources = await this.options.profiles.prepareSession({
			namespace: input.namespace,
			sessionId: session.id,
			source: session.source,
			profile: session.profile,
			headed: session.headed,
		});
		const allowedHosts = [...(input.allowedHosts ?? [])];
		this.records.set(keyOf(input.namespace, session.id), {
			namespace: input.namespace,
			session,
			allowedHosts,
			revision: 0,
			currentUrl: "",
			resources,
		});
		return session;
	}

	getSession(input: BrowserSessionInput): BrowserSession {
		const record = this.records.get(keyOf(input.namespace, input.sessionId));
		if (!record) {
			throw new BrowserAutomationError(
				"session_not_found",
				`Session ${input.sessionId} not found in namespace ${input.namespace}`,
			);
		}
		return record.session;
	}

	async closeSession(input: BrowserSessionInput, signal?: AbortSignal): Promise<void> {
		const record = this.records.get(keyOf(input.namespace, input.sessionId));
		if (!record) return;
		const session = toEngineSession(record.resources);
		await this.options.engine.close(session, signal);
		await this.options.profiles.releaseSession(record.resources);
		this.records.delete(keyOf(input.namespace, input.sessionId));
	}

	async closeAll(): Promise<void> {
		const records = [...this.records.values()];
		await Promise.all(
			records.map(async (record) => {
				await this.options.engine.close(toEngineSession(record.resources));
				await this.options.profiles.releaseSession(record.resources);
			}),
		);
		this.records.clear();
	}

	async closeReleasedSessions(namespace: string, sessionIds: readonly string[]): Promise<void> {
		for (const id of sessionIds) {
			await this.closeSession({ namespace, sessionId: id });
		}
	}

	// ========== Browser Operations ==========

	async navigate(input: BrowserNavigateInput, signal?: AbortSignal): Promise<BrowserPageState> {
		const record = this.requireRecord(input.namespace, input.sessionId);
		const cleanedUrl = assertAllowedBrowserUrl(input.url, record.allowedHosts);
		const pageState = await this.options.sessions.runExclusive(input.namespace, input.sessionId, async () => {
			const result = await this.options.engine.navigate(toEngineSession(record.resources), cleanedUrl, signal);
			await this.containPolicyEscape(input.namespace, input.sessionId, result.url, record.allowedHosts);
			record.currentUrl = result.url;
			record.revision += 1;
			return {
				sessionId: record.session.id,
				revision: record.revision,
				url: record.currentUrl,
				title: result.title,
			} satisfies BrowserPageState;
		});
		return pageState;
	}

	async snapshot(
		input: BrowserSnapshotInput,
		signal?: AbortSignal,
	): Promise<{
		sessionId: string;
		revision: number;
		url: string;
		title?: string;
		content: string;
	}> {
		const record = this.requireRecord(input.namespace, input.sessionId);
		const result = await this.options.sessions.runExclusive(input.namespace, input.sessionId, async () => {
			const engineResult = await this.options.engine.snapshot(
				toEngineSession(record.resources),
				input.interactiveOnly ?? false,
				signal,
			);
			await this.containPolicyEscape(input.namespace, input.sessionId, engineResult.url, record.allowedHosts);
			record.currentUrl = engineResult.url || record.currentUrl;
			return {
				sessionId: record.session.id,
				revision: record.revision,
				url: record.currentUrl,
				title: engineResult.title,
				content: engineResult.output ?? "",
			};
		});
		return result;
	}

	async readText(
		input: BrowserReadTextInput,
		signal?: AbortSignal,
	): Promise<{
		sessionId: string;
		revision: number;
		url: string;
		title?: string;
		text: string;
		truncated: boolean;
	}> {
		const record = this.requireRecord(input.namespace, input.sessionId);
		const result = await this.options.sessions.runExclusive(input.namespace, input.sessionId, async () => {
			const engineResult = await this.options.engine.readText(toEngineSession(record.resources), signal);
			await this.containPolicyEscape(input.namespace, input.sessionId, engineResult.url, record.allowedHosts);
			const raw = engineResult.output ?? "";
			const maxChars = input.maxChars ?? raw.length;
			const text = raw.slice(0, maxChars);
			record.currentUrl = engineResult.url || record.currentUrl;
			return {
				sessionId: record.session.id,
				revision: record.revision,
				url: record.currentUrl,
				title: engineResult.title,
				text,
				truncated: raw.length > text.length,
			};
		});
		return result;
	}

	async screenshot(
		input: BrowserScreenshotInput,
		signal?: AbortSignal,
	): Promise<{ sessionId: string; revision: number; dataUrl: string }> {
		const record = this.requireRecord(input.namespace, input.sessionId);
		const result = await this.options.sessions.runExclusive(input.namespace, input.sessionId, async () => {
			const engineResult = await this.options.engine.screenshot(
				toEngineSession(record.resources),
				input.fullPage ?? false,
				signal,
			);
			await this.containPolicyEscape(input.namespace, input.sessionId, engineResult.url, record.allowedHosts);
			record.currentUrl = engineResult.url || record.currentUrl;
			record.revision += 1;
			return {
				sessionId: record.session.id,
				revision: record.revision,
				dataUrl: engineResult.dataUrl,
			};
		});
		return result;
	}

	async act(
		input: BrowserActInput,
		signal?: AbortSignal,
	): Promise<{
		sessionId: string;
		revision: number;
		url: string;
		title?: string;
		output: string;
	}> {
		const record = this.requireRecord(input.namespace, input.sessionId);
		if (input.snapshotRevision !== undefined && input.snapshotRevision !== record.revision) {
			throw new BrowserAutomationError(
				"stale_snapshot",
				`Snapshot revision ${input.snapshotRevision} is stale; current is ${record.revision}`,
			);
		}
		const result = await this.options.sessions.runExclusive(input.namespace, input.sessionId, async () => {
			const engineResult = await this.options.engine.act(toEngineSession(record.resources), input.action, signal);
			await this.containPolicyEscape(input.namespace, input.sessionId, engineResult.url, record.allowedHosts);
			record.currentUrl = engineResult.url || record.currentUrl;
			record.revision += 1;
			return {
				sessionId: record.session.id,
				revision: record.revision,
				url: record.currentUrl,
				title: engineResult.title,
				output: engineResult.output ?? "",
			};
		});
		return result;
	}

	private requireRecord(namespace: string, sessionId: string): BrowserSessionRecord {
		const record = this.records.get(keyOf(namespace, sessionId));
		if (!record) {
			throw new BrowserAutomationError(
				"session_not_found",
				`Browser session "${sessionId}" not found in namespace "${namespace}"`,
			);
		}
		return record;
	}

	/**
	 * 安全边界：断言返回 URL 未越界；越界则强制关闭 session 后重新抛出错误。
	 *
	 * agent-browser 操作执行完成后，JS 可能把 URL 跳转越出 allowedHosts（广告跳转、
	 * 社交分享等）。此时 session 仍存活会继续接受命令——安全模型形同虚设。
	 * 所以一旦检测到 escape，立刻 engine.close + profile.release + records.delete。
	 */
	private async containPolicyEscape(
		namespace: string,
		sessionId: string,
		url: string,
		allowedHosts: readonly string[] | undefined,
	): Promise<void> {
		try {
			assertReturnedPageAllowed(url, allowedHosts);
		} catch (err) {
			if (err instanceof BrowserAutomationError && err.code === "policy_escape") {
				const record = this.records.get(keyOf(namespace, sessionId));
				if (record) {
					try {
						await this.options.engine.close(toEngineSession(record.resources));
						await this.options.profiles.releaseSession(record.resources);
					} catch {
						// 关闭失败已在 best-effort 路径里吞掉，这里只保证清理内存
					}
					this.records.delete(keyOf(namespace, sessionId));
					this.options.logger.warn("contained policy escape — session force-closed", {
						namespace,
						sessionId,
						url,
					});
				}
			}
			throw err;
		}
	}
}

function keyOf(namespace: string, sessionId: string): string {
	return `${namespace}:${sessionId}`;
}

function toEngineSession(resources: SessionResources) {
	return {
		id: resources.sessionId,
		source: resources.source,
		profile: resources.profile,
		headed: resources.headed,
		configPath: resources.configPath,
	};
}
