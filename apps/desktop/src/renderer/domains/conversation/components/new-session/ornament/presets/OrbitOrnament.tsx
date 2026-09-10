import { OrbitOrb } from "@shared/components/orb/OrbitOrb";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { useOrnamentSlot } from "../useOrnamentSlot";

/** 球体直径：比 Vivi 的素材小一圈，压不到选项行的 chip。 */
const ORB_SIZE = 96;
/**
 * 星轨比 Vivi 窄得多（96 对 144），沿用 Vivi 那条 480 的门槛会让它在还放得下的宽度上
 * 就提前消失，所以按自己的宽度另算一档。
 */
const ORBIT_MIN_SLOT_WIDTH = 360;

interface OrbitOrnamentProps {
	autoplay: boolean;
	mounted: boolean;
}

/**
 * 星轨装饰件：一枚停在输入框顶边上的着色器球，指上去会活过来。
 *
 * 与 Vivi 同一套插槽约定：容器锚在 hero 上、下探 75px（hero mb-3 + 选项行 h-7 + 行 mb-4 = 56，
 * 再加 19），所以 `bottom-[19px]` 正好让球的下缘落在输入框顶边上，不进框。
 * 页面被压窄时整块不渲染——同时也把 WebGL 循环停掉。
 */
export function OrbitOrnament({ autoplay, mounted }: OrbitOrnamentProps): JSX.Element {
	const reduceMotion = useReducedMotion();
	const [hovered, setHovered] = useState(false);
	const slot = useOrnamentSlot(ORBIT_MIN_SLOT_WIDTH);
	// 关掉「头像动效」或系统要求减少动效时，球停在静息帧，hover 也不该让它动起来。
	const reactive = autoplay && !reduceMotion;

	return (
		<motion.div
			initial={{ opacity: 0 }}
			animate={{ opacity: mounted ? 1 : 0 }}
			transition={{ duration: 0.5, delay: 0.2 }}
			className="pointer-events-none absolute inset-x-0 -bottom-[75px] z-30 h-20 select-none"
			ref={slot.ref}
		>
			{slot.visible ? (
				// 命中区跟着 rounded-full 收成圆形：方盒子的四角离球面挺远，指在那儿就变形会很怪。
				// 球本身不可点，只接 hover，所以不给 cursor 也不做 focus 态。
				<div
					className="pointer-events-auto absolute right-2 bottom-[19px] rounded-full"
					onPointerEnter={() => setHovered(true)}
					onPointerLeave={() => setHovered(false)}
				>
					<OrbitOrb
						size={ORB_SIZE}
						state={reactive && hovered ? "speaking" : "idle"}
						paused={!reactive}
					/>
				</div>
			) : null}
		</motion.div>
	);
}
