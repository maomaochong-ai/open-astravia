/**
 * 活动面板铺满时，面板顶栏需要为宿主「让」出来多少像素。
 *
 * 铺满态面板贴到窗口第一像素，但两块系统 UI 抢同一个位置：
 *
 * - macOS 的窗口按钮（红绿灯）压在最左上角，是**系统绘制**的、不参与布局。顶栏如果
 *   `pt-0` 顶到 0，页签行与面板上分割线正好落在按钮下方——实测就是「圆点与分割线
 *   细微重叠」。让出一个按钮高度后页签从按钮下缘开始。
 * - Windows / Linux 没有浮在内容上的窗口按钮（标题栏由应用自己画，且已在铺满时让位），
 *   顶栏必须贴到 0；多给任何内边距都会变成「页签离屏幕顶还有一条空带」。
 *
 * 非铺满态不需要让位：那时顶栏在内容区里，红绿灯的高度已经由页面页头承担。
 */
export const MAC_MAXIMIZED_TOP_INSET = 28;

export interface ActivityPanelTopInsetInput {
	readonly isMac: boolean;
	readonly isMaximized: boolean;
}

export function resolveActivityPanelTopInset({ isMac, isMaximized }: ActivityPanelTopInsetInput): number {
	if (!isMaximized) return 0;
	return isMac ? MAC_MAXIMIZED_TOP_INSET : 0;
}
