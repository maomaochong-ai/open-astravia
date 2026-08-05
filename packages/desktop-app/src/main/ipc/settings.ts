import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@vetta/coding-agent";
import { atomicWriteJSON } from "@vetta/toolkit/atomic-write";
import { app, BrowserWindow, ipcMain, powerMonitor } from "electron";
import lockfile from "proper-lockfile";
import type { RefreshOutcome } from "../../preload/api.js";
import { syncCredentialFile } from "../auth/credential-store.js";
import { DEFAULT_SERVER_URL, DEFAULT_SITE_URL } from "../constants.js";
import { getAppLogger } from "../logger.js";
import {
	listPresetProviders,
	refreshPresetCatalog,
	refreshPresetModels,
	startPresetModelsAutoSync,
} from "../models/presets/sync.js";
import { peekSharedRuntime } from "../runtime.js";

const settingsLog = getAppLogger("settings");

function getSettingsPath(): string {
	return join(getAgentDir(), "settings.json");
}

export function readSettings(): Record<string, unknown> {
	const path = getSettingsPath();
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return {};
	}
}

// 刻意不导出：整份写回必须经 updateSettings 在锁内完成，
// 裸写会绕过跨进程互斥，重新打开被覆盖的窗口。
function writeSettings(settings: Record<string, unknown>): void {
	atomicWriteJSON(getSettingsPath(), settings);
}

/**
 * 锁内读-改-写 settings.json。所有「读出整份 → 改几个键 → 整份写回」都必须走这里。
 *
 * settings.json 是**跨进程**共享的：coding-agent 的 FileSettingsStorage 用
 * proper-lockfile 锁同一个文件，同机再跑一个客户端实例（dev + 打包版）也会写它。
 * 无锁的读-改-写之间被别的进程插一次写，就会整份覆盖回旧内容——落到 token 上
 * 就是把已经轮换掉的 serverRefreshToken 写回去，下次 refresh 出示的即是已撤销值，
 * 服务端按重放处理，用户直接掉登录。
 *
 * 用与 coding-agent 相同的库和锁文件（`<path>.lock`）才能真正互斥。
 * 文件尚不存在时不加锁（与 coding-agent 的处理一致）：此时没有别的内容可覆盖。
 */
export function updateSettings(mutate: (settings: Record<string, unknown>) => void): void {
	const path = getSettingsPath();
	let release: (() => void) | undefined;
	try {
		if (existsSync(path)) {
			release = lockfile.lockSync(path, { realpath: false });
		}
		const settings = readSettings();
		mutate(settings);
		writeSettings(settings);
	} finally {
		release?.();
	}
}

interface RemoteProvidersResult {
	providers: Record<string, unknown>;
	error?: string;
}

// 主进程发起的请求遇到 401 时，广播给所有渲染窗口，
// 让渲染层统一走 logout 流程（清 token / user / 远程 providers / SSE）。
// 不要在这里做任何会影响本地会话的事——本地模型用户可完全离线运行。
function broadcastUnauthorized(reason: string): void {
	settingsLog.warn(`广播 unauthorized，渲染层将登出：${reason}`);
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) {
			win.webContents.send("vetta:auth:unauthorized");
		}
	}
}

// refresh token 流：通知渲染层有新的 access/refresh，由渲染层负责 set atom + localStorage。
function broadcastTokenRefreshed(accessToken: string, refreshToken: string): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) {
			win.webContents.send("vetta:auth:token-refreshed", { accessToken, refreshToken });
		}
	}
}

/**
 * 主进程内部使用的 token refresh。
 * - 进程内单飞（去重）：并发请求只触发一次 refresh。
 * - 成功：写回 settings.json，广播 token-refreshed 给渲染层。
 * - 失败：返回三态结果（见 RefreshOutcome），由调用方决定是否登出。
 *   只有 unauthorized 才该登出；transient（网络/超时/5xx）必须保留会话。
 */
let refreshInFlight: Promise<RefreshOutcome> | null = null;

// 远大于真实刷新延迟（正常 <100ms）。一次性轮转下，绝不能因为短超时丢弃一个
// 服务端可能已提交的轮转响应——那会让 settings.json 永久停在已撤销的 refresh token。
// 这里只用一个宽松上限防止真正挂死的连接无限占用 single-flight。
const REFRESH_TIMEOUT_MS = 30_000;

function persistTokens(access: string, refresh: string): void {
	updateSettings((settings) => {
		settings.serverToken = access;
		settings.serverRefreshToken = refresh;
	});
	// 同步下沉给独立进程（内置 MCP server 读它拿登录态）
	syncCredentialFile(access);
	// 同步给已运行的 coding-agent session，避免它继续用旧 access token
	const runtime = peekSharedRuntime();
	if (runtime) {
		void runtime.reloadServerAuth(access).catch((err) => {
			settingsLog.warn("reloadServerAuth after refresh failed:", err);
		});
	}
}

/**
 * 读 401 响应体里的业务错误码。掉登录的排查全靠它区分三种成因：
 * 40105 无效（本地存的值服务端根本不认识）/ 40106 过期（离线超过 refresh TTL）/
 * 40107 已撤销（被轮换掉后重放，或整条链被判定盗用）。只看 HTTP 401 分不出来。
 * 响应体已被读走，调用方不要再读第二次。
 */
async function describeRefreshRejection(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as { code?: number; message?: string };
		return `code=${body.code ?? "?"} message=${body.message ?? ""}`;
	} catch {
		return "code=? (响应体非 JSON)";
	}
}

export async function tryRefreshAccessToken(): Promise<RefreshOutcome> {
	if (refreshInFlight) return refreshInFlight;
	refreshInFlight = (async (): Promise<RefreshOutcome> => {
		const settings = readSettings();
		const refreshToken = settings.serverRefreshToken as string | undefined;
		if (!refreshToken) {
			settingsLog.warn("refresh 放弃：settings.json 里没有 serverRefreshToken，按未登录处理");
			return { status: "unauthorized" };
		}
		const url = `${DEFAULT_SERVER_URL.replace(/\/$/, "")}/auth/refresh`;
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
			let response: Response;
			try {
				response = await fetch(url, {
					method: "POST",
					signal: controller.signal,
					headers: {
						Accept: "application/json",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ refresh_token: refreshToken }),
				});
			} finally {
				clearTimeout(timeout);
			}
			// 服务端对 refresh token 失效/过期/撤销一律返回 HTTP 401（见 api errcode 40105/40106/40107）。
			// 这是唯一应当登出的明确信号。
			if (response.status === 401) {
				settingsLog.warn(`refresh 被拒绝(401)，即将登出：${await describeRefreshRejection(response)}`);
				return { status: "unauthorized" };
			}
			// 其它非 2xx（5xx 等）视为暂时性，保留会话。
			if (!response.ok) {
				settingsLog.warn(`refresh 暂时性失败：HTTP ${response.status}，保留会话`);
				return { status: "transient" };
			}
			const body = (await response.json()) as {
				code: number;
				data?: { access_token?: string; refresh_token?: string };
			};
			// 200 但 body 异常：保守按暂时性处理，不登出。
			if (body.code !== 0 || !body.data?.access_token || !body.data?.refresh_token) {
				settingsLog.warn(`refresh 返回 200 但响应体异常(code=${body.code})，按暂时性处理，保留会话`);
				return { status: "transient" };
			}
			persistTokens(body.data.access_token, body.data.refresh_token);
			broadcastTokenRefreshed(body.data.access_token, body.data.refresh_token);
			return { status: "ok", accessToken: body.data.access_token };
		} catch (error) {
			// 网络失败 / abort / 超时 → 暂时性，绝不登出。
			settingsLog.warn("refresh 请求失败(网络/超时)，保留会话:", error);
			return { status: "transient" };
		}
	})();
	try {
		return await refreshInFlight;
	} finally {
		refreshInFlight = null;
	}
}

/**
 * 带 401 自动 refresh 的 GET 请求。
 * - 第一次 401 → 尝试 refresh → 拿到新 token 后用新 token 重试一次
 * - refresh 失败或重试仍 401 → 广播 unauthorized，由渲染层决定 logout
 */
async function authedGet(path: string, timeoutMs = 5000): Promise<Response | null> {
	const settings = readSettings();
	let token = settings.serverToken as string | undefined;
	if (!token) return null;
	const url = `${DEFAULT_SERVER_URL.replace(/\/$/, "")}${path}`;
	const doFetch = async (t: string): Promise<Response> => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			return await fetch(url, {
				signal: controller.signal,
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${t}`,
				},
			});
		} finally {
			clearTimeout(timer);
		}
	};
	let res = await doFetch(token);
	if (res.status === 401) {
		const outcome = await tryRefreshAccessToken();
		if (outcome.status === "unauthorized") {
			broadcastUnauthorized(`${path} 返回 401 且 refresh 失败`);
			return res;
		}
		if (outcome.status === "transient") {
			// 暂时性失败（网络/超时/5xx）：保留会话，返回原 401，调用方按"暂不可达"降级。
			return res;
		}
		token = outcome.accessToken;
		res = await doFetch(token);
		if (res.status === 401) {
			// 用刚换来的新 token 仍 401 → 确属鉴权失败，登出。
			broadcastUnauthorized(`${path} 用刚刷新的 token 重试仍返回 401`);
		}
	}
	return res;
}

export async function fetchRemoteProviders(): Promise<RemoteProvidersResult> {
	try {
		const response = await authedGet("/providers/models.json");
		if (!response) return { providers: {}, error: "未登录" };
		if (response.status === 401) return { providers: {}, error: "unauthorized" };
		if (!response.ok) return { providers: {}, error: `HTTP ${response.status}` };

		const body = (await response.json()) as { code: number; data?: { providers?: Record<string, unknown> } };
		if (body.code !== 0 || !body.data?.providers) {
			return { providers: {} };
		}
		return { providers: body.data.providers };
	} catch {
		return { providers: {}, error: "服务器不可达" };
	}
}

interface SubscriptionWindow {
	kind: "5h" | "week" | "month";
	limit: number;
	consumed: number;
	reset_at: string;
}

interface SubscriptionStatus {
	active: boolean;
	go_enabled: boolean;
	tier_id?: string;
	tier_name?: string;
	badge_text?: string;
	badge_color?: string;
	description?: string;
	expires_at?: string;
	windows?: SubscriptionWindow[];
}

async function fetchSubscriptionStatus(): Promise<{ status: SubscriptionStatus | null; error?: string }> {
	try {
		const response = await authedGet("/subscription/me");
		if (!response) return { status: null, error: "未登录" };
		if (response.status === 401) return { status: null, error: "unauthorized" };
		if (!response.ok) return { status: null, error: `HTTP ${response.status}` };

		const body = (await response.json()) as { code: number; data?: SubscriptionStatus };
		if (body.code !== 0 || !body.data) {
			return { status: null };
		}
		return { status: body.data };
	} catch {
		return { status: null, error: "服务器不可达" };
	}
}

/**
 * focus / 系统 wake 时若 access token 剩余寿命 < WAKE_REFRESH_THRESHOLD_MS，主动 refresh。
 * 解决"合上笔记本一夜，第二天第一个请求 401 才被动刷新"的体感问题。
 */
const WAKE_REFRESH_THRESHOLD_MS = 10 * 60 * 1000;

function decodeAccessTokenExpMs(token: string): number | null {
	const parts = token.split(".");
	if (parts.length !== 3) return null;
	try {
		const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
		const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
		const json = JSON.parse(Buffer.from(padded, "base64").toString("utf-8")) as { exp?: number };
		if (typeof json.exp !== "number") return null;
		return json.exp * 1000;
	} catch {
		return null;
	}
}

function maybeRefreshOnWake(reason: string): void {
	const settings = readSettings();
	const token = settings.serverToken as string | undefined;
	if (!token) return;
	const expMs = decodeAccessTokenExpMs(token);
	if (expMs === null) return;
	const remaining = expMs - Date.now();
	if (remaining > WAKE_REFRESH_THRESHOLD_MS) return;
	// tryRefreshAccessToken 内部有 single-flight，重复触发安全
	void tryRefreshAccessToken().catch((err) => {
		settingsLog.warn(`wake refresh (${reason}) failed:`, err);
	});
}

function registerWakeRefreshHooks(): () => void {
	const onFocus = () => maybeRefreshOnWake("focus");
	const onResume = () => maybeRefreshOnWake("resume");
	app.on("browser-window-focus", onFocus);
	powerMonitor.on("resume", onResume);
	return () => {
		app.off("browser-window-focus", onFocus);
		powerMonitor.off("resume", onResume);
	};
}

export function registerSettingsIpc(): () => void {
	// 清理 settings.json 中残留的 serverUrl，现在统一由环境变量管理
	if ("serverUrl" in readSettings()) {
		updateSettings((settings) => {
			delete settings.serverUrl;
		});
	}

	ipcMain.handle("vetta:settings:get-server-url", () => {
		return DEFAULT_SERVER_URL;
	});

	ipcMain.handle("vetta:settings:get-site-url", () => {
		return DEFAULT_SITE_URL;
	});

	ipcMain.handle("vetta:settings:get-server-token", () => {
		const settings = readSettings();
		return (settings.serverToken as string | undefined) ?? undefined;
	});

	ipcMain.handle("vetta:settings:set-server-token", async (_event, token: unknown) => {
		const nextToken = typeof token === "string" ? token : undefined;
		updateSettings((settings) => {
			if (nextToken !== undefined) {
				settings.serverToken = nextToken;
			} else {
				delete settings.serverToken;
			}
		});
		// 同步下沉给独立进程（内置 MCP server 读它拿登录态）；登出时会删掉该文件
		syncCredentialFile(nextToken);
		// Push fresh auth to any active sessions so they pick up the new token
		// without requiring an app restart (fixes 401-after-login bug).
		const runtime = peekSharedRuntime();
		if (runtime) {
			try {
				await runtime.reloadServerAuth(nextToken);
			} catch (err) {
				settingsLog.warn("reloadServerAuth failed:", err);
			}
		}
	});

	ipcMain.handle("vetta:settings:get-server-refresh-token", () => {
		const settings = readSettings();
		return (settings.serverRefreshToken as string | undefined) ?? undefined;
	});

	ipcMain.handle("vetta:settings:set-server-refresh-token", (_event, token: unknown) => {
		const nextToken = typeof token === "string" ? token : undefined;
		updateSettings((settings) => {
			if (nextToken !== undefined) {
				settings.serverRefreshToken = nextToken;
			} else {
				delete settings.serverRefreshToken;
			}
		});
	});

	ipcMain.handle("vetta:models:fetch-remote", async () => {
		return fetchRemoteProviders();
	});

	// 预设服务商目录内置在客户端(见 ADR-0050);模型清单取自 models.dev 公共目录,免 key 可见。
	ipcMain.handle("vetta:models:list-presets", async () => {
		return listPresetProviders();
	});

	// 手动刷新某预设服务商的模型列表:只拉不写,由渲染层连同 key 一起落盘。
	ipcMain.handle("vetta:models:refresh-preset-models", async (_event, providerId: unknown, apiKey: unknown) => {
		if (typeof providerId !== "string" || !providerId.trim()) {
			return { models: [], error: { code: "unknown-provider", params: { provider: String(providerId) } } };
		}
		return refreshPresetModels(providerId.trim(), typeof apiKey === "string" ? apiKey : undefined);
	});

	// 手动刷新公共目录:清掉失败冷却强制重拉,错误原样回给渲染层。
	ipcMain.handle("vetta:models:refresh-preset-catalog", async () => {
		return refreshPresetCatalog();
	});

	// 启动时同步一次已启用预设服务商的模型列表,之后每 12 小时一次。
	// 即便用户从不打开设置页,ModelSelector 也能拿到上游最新模型。失败静默(保留本地快照)。
	const stopPresetAutoSync = startPresetModelsAutoSync();

	ipcMain.handle("vetta:subscription:status", async () => {
		return fetchSubscriptionStatus();
	});

	// 渲染层 401 时统一委托主进程 refresh，避免跨进程并发使用同一 refresh_token
	// 触发服务端 reuse-detection（revoked）导致误踢登录。
	ipcMain.handle("vetta:auth:refresh-token", async () => {
		return tryRefreshAccessToken();
	});

	const teardownWakeHooks = registerWakeRefreshHooks();

	return () => {
		teardownWakeHooks();
		stopPresetAutoSync();
		ipcMain.removeHandler("vetta:settings:get-server-url");
		ipcMain.removeHandler("vetta:settings:get-server-token");
		ipcMain.removeHandler("vetta:settings:set-server-token");
		ipcMain.removeHandler("vetta:settings:get-server-refresh-token");
		ipcMain.removeHandler("vetta:settings:set-server-refresh-token");
		ipcMain.removeHandler("vetta:models:fetch-remote");
		ipcMain.removeHandler("vetta:models:list-presets");
		ipcMain.removeHandler("vetta:models:refresh-preset-catalog");
		ipcMain.removeHandler("vetta:models:refresh-preset-models");
		ipcMain.removeHandler("vetta:subscription:status");
		ipcMain.removeHandler("vetta:auth:refresh-token");
	};
}
