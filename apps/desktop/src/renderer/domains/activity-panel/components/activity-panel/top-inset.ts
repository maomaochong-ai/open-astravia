/**
 * 活动面板铺满时，面板顶栏需要为宿主「让」出来多少像素。
 *
 * 铺满态面板贴到窗口第一像素。macOS 的窗口按钮（红绿灯）是**系统绘制**的、不参与布局，
 * 所以它们与顶栏只能靠**横向**让位解决：调用方在 macOS 铺满时给顶栏 `pl-[78px]`
 * （`macTrafficLightGutter`），页签整排从圆点右侧开始，绝不会叠上去。
 *
 * 既然横向已经分开，纵向就不再需要整整一个标题栏的高度：
 * 旧值 28px 是「让出按钮高度」的做法，结果页签被推离窗口顶 28px，macOS 上表现为
 * 「标签页离屏幕顶有很大一条空带」，而 Windows 因为本来就是 0 反而正常。
 * 现在只留 4px 呼吸位：页签与红绿灯同处标题栏这一带，视觉上与原生应用一致。
 *
 * Windows / Linux 仍必须贴 0：那边标题栏由应用绘制，多给任何内边距都是一条空带。
 * 非铺满态不需要让位。
 */
export const MAC_MAXIMIZED_TOP_INSET = 4;

export interface ActivityPanelTopInsetInput {
	readonly isMac: boolean;
	readonly isMaximized: boolean;
}

export function resolveActivityPanelTopInset({ isMac, isMaximized }: ActivityPanelTopInsetInput): number {
	if (!isMaximized) return 0;
	return isMac ? MAC_MAXIMIZED_TOP_INSET : 0;
}
