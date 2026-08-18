import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@vetta/coding-agent/config";
import { atomicWriteJSON } from "@vetta/toolkit/atomic-write";
import { ipcMain } from "electron";
import lockfile from "proper-lockfile";
import { DEFAULT_SERVER_URL, DEFAULT_SITE_URL } from "../constants.js";
import {
	listPresetProviders,
	refreshPresetCatalog,
	refreshPresetModels,
	startPresetModelsAutoSync,
} from "../models/presets/sync.js";

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
 * settings.json 是**跨进程**共享的：runtime-node 的 NodeScopedTextStorage 用
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

	return () => {
		stopPresetAutoSync();
		ipcMain.removeHandler("vetta:settings:get-server-url");
		ipcMain.removeHandler("vetta:models:list-presets");
		ipcMain.removeHandler("vetta:models:refresh-preset-catalog");
		ipcMain.removeHandler("vetta:models:refresh-preset-models");
	};
}
