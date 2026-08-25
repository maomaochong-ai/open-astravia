import type { PluginCommandApi } from "@vetta-org/plugin-sdk";
import {
	type BrowserSessionInfo,
	type BrowserTabInfo,
	type SavedCredential,
	parseAuthProfiles,
	parseSessions,
	parseTabs,
} from "./parse";

/**
 * 面板用的 agent-browser CLI 客户端。
 *
 * 刻意**不传 `--config`**：面板要的都是与浏览器配置无关的只读信息（daemon 里有哪些会话、
 * 某会话有哪些 tab、本机存了哪些登录凭据），传配置只会把「面板必须知道插件数据目录的绝对
 * 路径」这条依赖引进来，而 renderer 恰恰算不准那个路径（见 config/settings.ts 的说明）。
 *
 * 面板与 MCP wrapper 命中的是同一个常驻 daemon，所以这里看到的就是 Agent 正在用的东西。
 */

const QUERY_TIMEOUT_MS = 15_000;

export interface CliResult<T> {
	ok: boolean;
	value: T;
	/** 失败时的原始错误文本，用于面板展示与复制。 */
	error?: string;
}

async function query<T>(
	command: PluginCommandApi,
	args: string[],
	parse: (stdout: string) => T,
	empty: T,
): Promise<CliResult<T>> {
	try {
		const result = await command.run("agent-browser", args, { timeoutMs: QUERY_TIMEOUT_MS });
		if (result.exitCode !== 0) {
			return { ok: false, value: empty, error: result.stderr.trim() || result.stdout.trim() };
		}
		return { ok: true, value: parse(result.stdout) };
	} catch (error) {
		// 二进制不存在时 command.run 直接 reject，这是「还没安装」而不是「查询失败」，
		// 由调用方结合运行时状态解释。
		return { ok: false, value: empty, error: error instanceof Error ? error.message : String(error) };
	}
}

export function listSessions(command: PluginCommandApi): Promise<CliResult<BrowserSessionInfo[]>> {
	return query(command, ["--json", "session", "list"], parseSessions, []);
}

export function listTabs(command: PluginCommandApi, sessionId: string): Promise<CliResult<BrowserTabInfo[]>> {
	return query(command, ["--session", sessionId, "--json", "tab", "list"], parseTabs, []);
}

export function listCredentials(command: PluginCommandApi): Promise<CliResult<SavedCredential[]>> {
	return query(command, ["--json", "auth", "list"], parseAuthProfiles, []);
}

export async function deleteCredential(command: PluginCommandApi, name: string): Promise<CliResult<null>> {
	return query(command, ["auth", "delete", name], () => null, null);
}

/**
 * 切到指定会话的指定 tab。
 *
 * 这也是面板「唤起窗口」按钮的实现：CDP 的 target 激活会让承载该 tab 的 Chrome 窗口获得
 * 焦点。它不是一个真正的「窗口置顶」API——窗口管理不在 agent-browser 的能力面内——所以在
 * 某些窗口管理器下可能只切了 tab 而没把窗口提到最前。
 */
export function activateTab(command: PluginCommandApi, sessionId: string, ref: string): Promise<CliResult<null>> {
	return query(command, ["--session", sessionId, "tab", ref], () => null, null);
}

/**
 * 清除登录状态：清 Cookie 与本地存储。
 *
 * 这不等于删掉整个 profile 目录——IndexedDB、Service Worker 缓存不在覆盖范围内。删目录
 * 需要越出插件存储沙箱的文件操作，v1 不做；这里做的是能通过既有能力面完成、且覆盖绝大多数
 * 站点登录态的那部分，命名上也如实说明。
 */
export async function clearSignInState(command: PluginCommandApi, sessionId: string): Promise<CliResult<null>> {
	const cookies = await query(command, ["--session", sessionId, "cookies", "clear"], () => null, null);
	if (!cookies.ok) return cookies;
	return query(command, ["--session", sessionId, "storage", "clear"], () => null, null);
}
