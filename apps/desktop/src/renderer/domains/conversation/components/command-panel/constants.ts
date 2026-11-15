/**
 * 命令区「收起 → 展开」的动画参数。
 *
 * 只做不透明度淡入。历史沿革：先是 `height: 0 → auto` 弹簧（每帧走 layout，重绘整块
 * 面板），后来为了避开 layout 改成 `clip-path: inset()` 从上往下揭幕。列表上百行时，
 * 每帧重新裁剪整块面板同样不便宜，而用户对此的感知只有「点了之后是不是立刻出来」。
 * 现在用 opacity（走合成层，行数多少都不影响每帧成本），并且把时长压到 90ms；
 * 首帧布局的行数另由 `CommandPanelView` 的 `revealed` 分段渲染控制。
 */
export const PANEL_REVEAL_EASE = [0.22, 0.61, 0.36, 1] as const;
/** 90ms：淡入只负责「不是硬闪」，再长就会被读成「点了之后卡一下才出来」。 */
export const PANEL_REVEAL_MS = 90;
export const PANEL_REVEAL_DURATION = PANEL_REVEAL_MS / 1000;
export const PANEL_REVEAL_TRANSITION = {
	duration: PANEL_REVEAL_DURATION,
	ease: PANEL_REVEAL_EASE,
} as const;
