import { BlazeFlame } from "@shared/components/blaze/BlazeFlame";
import { motion, useReducedMotion } from "motion/react";
import { useOrnamentSlot } from "../useOrnamentSlot";

/** 火团直径：比星轨那枚 96 的球再小一圈，因为它外面还罩着一圈溢出的光晕。 */
const BLAZE_SIZE = 84;
/** 与星轨同宽档：两枚都是圆的，收起门槛没有理由不一样。 */
const BLAZE_MIN_SLOT_WIDTH = 360;

interface BlazeOrnamentProps {
	autoplay: boolean;
	mounted: boolean;
}

/**
 * 燃烧装饰件：一团停在输入框顶边上的火，自己慢慢烧着。
 *
 * 与星轨同一套插槽约定：容器锚在 hero 上、下探 75px（hero mb-3 + 选项行 h-7 + 行 mb-4 = 56，
 * 再加 19）。但这枚的光晕是向下偏 20px 的 box-shadow，按星轨那样 `bottom-[19px]` 让球贴住
 * 边，热区整个糊在输入框上，看着像压上去了；抬到 24px 留一线空隙，火团自己清清楚楚在框外。
 *
 * 不接任何交互：这块位置上火把已经占了「点一下」、星轨占了「指上去」，
 * 再加一层只会让四枚装饰件互相打架；这枚就只是烧着。
 */
export function BlazeOrnament({ autoplay, mounted }: BlazeOrnamentProps): JSX.Element {
	const reduceMotion = useReducedMotion();
	const slot = useOrnamentSlot(BLAZE_MIN_SLOT_WIDTH);
	// 关掉「头像动效」或系统要求减少动效时，火苗停在静息的那一帧，光晕也不再变色。
	const burning = autoplay && !reduceMotion;

	return (
		<motion.div
			initial={{ opacity: 0 }}
			animate={{ opacity: mounted ? 1 : 0 }}
			transition={{ duration: 0.5, delay: 0.2 }}
			className="pointer-events-none absolute inset-x-0 -bottom-[75px] z-30 h-20 select-none"
			ref={slot.ref}
		>
			{slot.visible ? (
				<BlazeFlame animate={burning} className="absolute right-3 bottom-[24px]" size={BLAZE_SIZE} />
			) : null}
		</motion.div>
	);
}
