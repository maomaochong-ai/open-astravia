/**
 * 命令区「默认态 → 展开态」的动画参数。
 *
 * 原实现是 `height: 0 → auto` 的弹簧：height 不可合成，每帧都要走
 * style → layout → paint → raster，重绘面积就是整块面板（含几十行列表与内联
 * SVG 图标）。而命令区本身是 `absolute bottom-full`，压根不参与布局流——高度
 * 动画对其它元素毫无影响，纯粹是为了「生长感」，却付了整条不可合成路径的代价，
 * 低配设备就掉在这里。现在改用 `clip-path: inset()` 从上往下揭幕：布局与绘制
 * 内容全程停在终态，每帧只重新裁剪一次，layout 一次都不跑。
 *
 * 刻意不用 transform 位移（更便宜）：内容一动，描边、圆角与「和输入卡片接成一
 * 整块」的接缝在动画中途就都不在终态位置上——半像素接缝会显出一条线，与卡片相
 * 接的两角会短暂露出背后的消息列表。视觉正确性优先于那点合成开销。
 *
 * 顺带解决的一个隐性抖动：`height: "auto"` 会在过滤词每变一次时重新测量并重定
 * 向弹簧，打字期间是持续的 layout 抖动。现在面板按内容自然高度直接跟随即可。
 *
 * 用固定时长的 tween 而不是弹簧：过冲的长尾在掉帧时格外显眼，而新会话页的 hero
 * 淡出与输入栏位移要和它同步，只有确定的时长才对得齐。
 */
export const PANEL_REVEAL_EASE = [0.22, 0.61, 0.36, 1] as const;
export const PANEL_REVEAL_MS = 190;
export const PANEL_REVEAL_DURATION = PANEL_REVEAL_MS / 1000;
export const PANEL_REVEAL_TRANSITION = {
	duration: PANEL_REVEAL_DURATION,
	ease: PANEL_REVEAL_EASE,
} as const;

/**
 * 揭幕期间 skill 列表先渲染的行数。
 *
 * 面板最高 320px、行高 32px，可视区本来就放不下更多；剩下的行等揭幕结束再补，
 * 免得「展开那一刻一次性布局上百行 + 上百个内联 SVG」全砸在动画首帧。
 */
export const PANEL_REVEAL_ROWS = 12;
