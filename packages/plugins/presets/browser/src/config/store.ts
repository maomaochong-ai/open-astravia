import type { PluginContext } from "@vetta-org/plugin-sdk";
import { type BrowserPluginSettings, normalizeBrowserSettings, RUNTIME_SNAPSHOT_FILE } from "./settings";

/**
 * 把宿主设置页的值物化成 wrapper 能读到的策略快照。
 *
 * 写入用 `ctx.storage`（物理目录 `~/.vetta/plugin-data/browser/`），正是 wrapper 独立
 * 解析出来的同一个目录。写入是原子替换，wrapper 不会读到半份文件。
 */
export async function persistSettingsSnapshot(ctx: PluginContext, settings: BrowserPluginSettings): Promise<void> {
	await ctx.storage.writeJson(RUNTIME_SNAPSHOT_FILE, settings);
}

/** 读当前设置（宿主设置页是唯一可写方，插件侧只读）。 */
export function readSettings(ctx: PluginContext): BrowserPluginSettings {
	return normalizeBrowserSettings(ctx.settings.getAll());
}

/**
 * 订阅设置变化并保持快照同步；返回取消订阅函数。
 *
 * 立即写一次而不是等第一次变更：首次启用时快照还不存在，wrapper 会退回默认策略跑，
 * 用户在设置页填过的值要到下次修改才生效——那是个很难自查的静默错位。
 */
export function syncSettingsSnapshot(ctx: PluginContext): () => void {
	void persistSettingsSnapshot(ctx, readSettings(ctx)).catch((error: unknown) => {
		ctx.ui.notify({ message: "浏览器操作：写入配置失败", error, variant: "error" });
	});
	const subscription = ctx.settings.onChange((values) => {
		void persistSettingsSnapshot(ctx, normalizeBrowserSettings(values)).catch((error: unknown) => {
			ctx.ui.notify({ message: "浏览器操作：写入配置失败", error, variant: "error" });
		});
	});
	return () => subscription.dispose();
}
