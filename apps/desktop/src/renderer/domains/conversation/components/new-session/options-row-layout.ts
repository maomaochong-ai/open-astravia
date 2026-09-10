import { OPTIONS_ROW_STACK_WIDTH } from "./constants";

/**
 * 选项行是否要把项目选择器让给输入框下方。
 *
 * 传 null（尚未测量）时返回 false：项目选择器是功能入口，宁可多测一帧再挪位置，
 * 也不能在首帧按猜的宽度把它渲染到错误的位置上。
 */
export function shouldStackProjectSelector(slotWidth: number | null, threshold = OPTIONS_ROW_STACK_WIDTH): boolean {
	return slotWidth !== null && slotWidth < threshold;
}
