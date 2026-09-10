import { EnergyWell } from "@shared/components/well/EnergyWell";
import { motion, useReducedMotion } from "motion/react";
import { useOrnamentSlot } from "../useOrnamentSlot";

/** 井体宽度：素材是竖长的（94:136），按 76 宽算出来约 110 高。
 * 画面重心在下半截的井台上，上半截是外扩的光锥与粒子，所以宽度要比燃烧那枚 84 的圆再给足些，
 * 井台看起来才和别的装饰件一样大。 */
const WELL_SIZE = 76;
/** 与星轨、燃烧同宽档：都是靠右摆一枚的形状，收起门槛没有理由不一样。 */
const WELL_MIN_SLOT_WIDTH = 360;

interface EnergyWellOrnamentProps {
	autoplay: boolean;
	mounted: boolean;
}

/**
 * 能源井装饰件：一座停在输入框顶边上的能量井，粒子一直往上飘。
 *
 * 与星轨同一套插槽约定：容器锚在 hero 上、下探 75px（hero mb-3 + 选项行 h-7 + 行 mb-4 = 56，
 * 再加 19），`bottom-[19px]` 让井体下缘落在输入框顶边上，不进框——井体本身比插槽高，
 * 往上探出去的那截正是要露的，所以插槽不裁剪。
 *
 * 不接任何交互：这块位置上火把已经占了「点一下」、星轨占了「指上去」，
 * 再加一层只会让装饰件互相打架；这枚就只是运转着。
 */
export function EnergyWellOrnament({ autoplay, mounted }: EnergyWellOrnamentProps): JSX.Element {
	const reduceMotion = useReducedMotion();
	const slot = useOrnamentSlot(WELL_MIN_SLOT_WIDTH);
	// 关掉「头像动效」或系统要求减少动效时，井停在静息帧：粒子不再飘，井体也不再浮动。
	const running = autoplay && !reduceMotion;

	return (
		<motion.div
			initial={{ opacity: 0 }}
			animate={{ opacity: mounted ? 1 : 0 }}
			transition={{ duration: 0.5, delay: 0.2 }}
			className="pointer-events-none absolute inset-x-0 -bottom-[75px] z-30 h-20 select-none"
			ref={slot.ref}
		>
			{slot.visible ? (
				<EnergyWell animate={running} className="absolute right-3 bottom-[19px]" size={WELL_SIZE} />
			) : null}
		</motion.div>
	);
}
