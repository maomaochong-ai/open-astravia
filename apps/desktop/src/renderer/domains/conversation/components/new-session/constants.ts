export const easeOut = [0.16, 1, 0.3, 1] as const;

// 矮窗口阈值：低于此高度时整体下移（减小底部留白）。
export const SHORT_VIEWPORT = 720;

/**
 * 命令区展开时输入栏下沉的门槛：能力条目多到这个数以上才让位。
 * 条目少时面板本来就长不到会盖住 hero 的高度，下沉纯属多余的一次位移。
 */
export const PANEL_SHIFT_MIN_ITEMS = 6;

/**
 * 装饰件所在插槽（= hero 宽度）低于此值时不渲染装饰件。
 * 素材宽 144px 且右锚，插槽再窄下去就会压到选项行的两枚 chip 与标题上；
 * 480 ≈ 选项行两枚 chip 的常见宽度 + 素材宽 + 余量。
 */
export const ORNAMENT_MIN_SLOT_WIDTH = 480;

/**
 * 选项行所在插槽（= hero 宽度）低于此值时，项目选择器改挂到输入框下方。
 * 三枚 chip 挤在一行会先把「切换智能体」截成省略号，再和右锚的装饰件叠在一起；
 * 560 ≈ 三枚 chip 的常见宽度 + 装饰件避让余量。
 */
export const OPTIONS_ROW_STACK_WIDTH = 560;
