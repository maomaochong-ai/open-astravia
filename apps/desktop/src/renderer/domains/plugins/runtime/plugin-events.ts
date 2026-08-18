export const PLUGINS_CHANGED_EVENT = "vetta:plugins-changed";

let resolvePluginHostReady: (() => void) | undefined;
let pluginHostReadyPromise = new Promise<void>((resolve) => {
	resolvePluginHostReady = resolve;
});

let resolvePluginHostFirstReady: (() => void) | undefined;
let pluginHostEverReady = false;
const pluginHostFirstReadyPromise = new Promise<void>((resolve) => {
	resolvePluginHostFirstReady = resolve;
});

function debugPluginAgent(message: string, data?: Record<string, unknown>): void {
	console.info(`[plugin-agent] ${message}${data ? ` ${JSON.stringify(data)}` : ""}`);
}

export function notifyPluginsChanged(): void {
	window.dispatchEvent(new Event(PLUGINS_CHANGED_EVENT));
}

export function markPluginHostLoading(): void {
	debugPluginAgent("host loading");
	pluginHostReadyPromise = new Promise<void>((resolve) => {
		resolvePluginHostReady = resolve;
	});
}

export function markPluginHostReady(): void {
	debugPluginAgent("host ready");
	resolvePluginHostReady?.();
	resolvePluginHostReady = undefined;
	pluginHostEverReady = true;
	resolvePluginHostFirstReady?.();
	resolvePluginHostFirstReady = undefined;
}

/**
 * 发送 prompt 前的插件工具就绪门：只等**首次**激活完成。
 *
 * 冷启动首轮 prompt 仍然会等插件工具 schema 注册齐（保持 af739f7a1 修复的语义）；
 * 但此后插件热重载/安装会走 last-known-good 保留（PluginGlobalSlotHost），旧工具
 * 注册依然有效，不应让每次插件集合变化都把发送消息挡住最长 5 秒——低配机上这正是
 * 「点发送后卡几秒」的主要来源之一。需要等「当前加载周期」的场景（如工作区视图
 * 路由）继续用 waitForPluginHostReady。
 */
export async function waitForPluginHostFirstReady(timeoutMs = 5000): Promise<void> {
	if (pluginHostEverReady) return;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let timedOut = false;
	debugPluginAgent("wait host first ready start", { timeoutMs });
	try {
		await Promise.race([
			pluginHostFirstReadyPromise,
			new Promise<void>((resolve) => {
				timeout = setTimeout(() => {
					timedOut = true;
					resolve();
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
		debugPluginAgent("wait host first ready end", { timedOut });
	}
}

export async function waitForPluginHostReady(timeoutMs = 5000): Promise<void> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let timedOut = false;
	debugPluginAgent("wait host ready start", { timeoutMs });
	try {
		await Promise.race([
			pluginHostReadyPromise,
			new Promise<void>((resolve) => {
				timeout = setTimeout(() => {
					timedOut = true;
					resolve();
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
		debugPluginAgent("wait host ready end", { timedOut });
	}
}
