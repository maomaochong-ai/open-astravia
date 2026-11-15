import type { PluginExternalApplication, PluginExternalApplicationKind } from "@astravia-org/plugin-sdk";

/**
 * 顶栏菜单的纯逻辑：只做「什么能进菜单、按什么顺序、图标怎么兜底」，
 * 平台探测与启动全部由宿主 `ctx.shell` 负责（第三步）。
 */

/** 每个分类的兜底图标：应用自己没图标时用它，至少还能认出「这是编辑器还是终端」。 */
export const KIND_ICON: Record<PluginExternalApplicationKind, string> = {
	editor: "icon-[solar--code-square-linear]",
	"file-manager": "icon-[solar--folder-open-linear]",
	terminal: "icon-[solar--programming-linear]",
	other: "icon-[solar--widget-2-linear]",
};

/** 菜单最多这么多项（宿主对顶栏菜单的上限也是 20）。 */
export const MAX_MENU_ITEMS = 20;

/**
 * 这个目录能不能交给本机应用打开。
 *
 * SSH 远程项目的目录不在本机，交给任何应用都只会打开一个不存在的路径；
 * 空目录同理会得到一条系统错误。两种情况都不该显示按钮。
 */
export function isOpenableCwd(cwd: string | null | undefined): cwd is string {
	return typeof cwd === "string" && cwd.length > 0 && !cwd.startsWith("ssh://");
}

/**
 * 同一分类内保持宿主给的顺序（宿主已按「编辑器 → 文件管理器 → 终端」排好），
 * 这里只保证分类顺序稳定，并把「系统默认处理程序」留在原位。
 */
export function sortForMenu(
	applications: readonly PluginExternalApplication[],
): readonly PluginExternalApplication[] {
	return [...applications].slice(0, MAX_MENU_ITEMS);
}

/** 文件管理器那一项用通用文案：Windows 上是「文件资源管理器」，Linux 上可能是别的。 */
export function labelKeyFor(app: PluginExternalApplication): string | null {
	return app.kind === "file-manager" ? "app.reveal" : null;
}
