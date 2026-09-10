import { ORNAMENT_MIN_SLOT_WIDTH } from "../constants";
import { useSlotWidth } from "../useSlotWidth";

export interface OrnamentSlot {
	/** 挂到装饰件插槽容器上；插槽宽度即 hero 宽度。 */
	readonly ref: React.RefObject<HTMLDivElement | null>;
	/** 插槽够宽才渲染装饰件。 */
	readonly visible: boolean;
}

/**
 * 按插槽实际宽度决定是否渲染装饰件。
 *
 * 未测量时不渲染：宁可晚一帧出现，也不要在窄页面先画出装饰件再抽掉。
 */
export function useOrnamentSlot(threshold = ORNAMENT_MIN_SLOT_WIDTH): OrnamentSlot {
	const { ref, width } = useSlotWidth();
	return { ref, visible: width !== null && width >= threshold };
}
