import type { PluginCommandApi, PluginFsApi, PluginOfficialApi } from "@vetta-org/plugin-sdk";

interface WorkbenchRuntime {
	command: PluginCommandApi | null;
	fs: PluginFsApi | null;
	plugins: PluginOfficialApi["plugins"] | null;
	dialog: PluginOfficialApi["dialog"] | null;
}

const KEY = "__vettaPluginWorkbenchRuntime__";

function runtime(): WorkbenchRuntime {
	const g = globalThis as Record<string, unknown>;
	if (!g[KEY]) {
		g[KEY] = { command: null, fs: null, plugins: null, dialog: null };
	}
	return g[KEY] as WorkbenchRuntime;
}

export function setWorkbenchRuntime(
	command: PluginCommandApi,
	fs: PluginFsApi,
	plugins: PluginOfficialApi["plugins"],
	dialog: PluginOfficialApi["dialog"],
): void {
	const r = runtime();
	r.command = command;
	r.fs = fs;
	r.plugins = plugins;
	r.dialog = dialog;
}

export function getWorkbenchPlugins(): PluginOfficialApi["plugins"] {
	const plugins = runtime().plugins;
	if (!plugins) throw new Error("Workbench plugins API not ready");
	return plugins;
}

export function getWorkbenchDialog(): PluginOfficialApi["dialog"] {
	const dialog = runtime().dialog;
	if (!dialog) throw new Error("Workbench dialog API not ready");
	return dialog;
}

export function getWorkbenchCommand(): PluginCommandApi {
	const command = runtime().command;
	if (!command) throw new Error("Workbench command API not ready");
	return command;
}

export function getWorkbenchFs(): PluginFsApi {
	const fs = runtime().fs;
	if (!fs) throw new Error("Workbench fs API not ready");
	return fs;
}

/** capability session 被 revoke 时宿主抛出的错误文案（经 IPC 后只剩 message）。 */
const SESSION_REVOKED_HINT = "capability session is not active";

const REVOKED_RETRY_DELAYS_MS = [150, 300, 600, 1000, 1500];

function isSessionRevoked(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes(SESSION_REVOKED_HINT);
}

/**
 * 每次调用都从 globalThis 取最新 fs，并在 session 被 revoke 时重试。
 *
 * 构建等长任务期间，被开发插件的 dev-watch 会触发全量插件重载，workbench 自身
 * re-activate 时旧 capability session 会被关闭；提前缓存的 fs 句柄随即失效。
 * 重试等待新 activation 写回 runtime 后再打一次。
 */
export async function withWorkbenchFs<T>(fn: (fs: PluginFsApi) => Promise<T>): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await fn(getWorkbenchFs());
		} catch (error) {
			const delay = REVOKED_RETRY_DELAYS_MS[attempt];
			if (delay === undefined || !isSessionRevoked(error)) throw error;
			await new Promise((resolve) => {
				setTimeout(resolve, delay);
			});
		}
	}
}
