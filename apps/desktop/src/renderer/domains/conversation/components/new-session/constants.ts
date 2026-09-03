export const easeOut = [0.16, 1, 0.3, 1] as const;

// 矮窗口阈值：低于此高度时整体下移（减小底部留白）。
export const SHORT_VIEWPORT = 720;

/**
 * 命令区展开时输入栏下沉的门槛：能力条目多到这个数以上才让位。
 * 条目少时面板本来就长不到会盖住 hero 的高度，下沉纯属多余的一次位移。
 */
export const PANEL_SHIFT_MIN_ITEMS = 6;

/**
 * 吉祥物所在插槽（= hero 宽度）低于此值时不渲染吉祥物。
 * 素材宽 144px 且右锚，插槽再窄下去就会压到选项行的两枚 chip 与标题上；
 * 480 ≈ 选项行两枚 chip 的常见宽度 + 素材宽 + 余量。
 */
export const MASCOT_MIN_SLOT_WIDTH = 480;
