import { PixelMarioBlocks } from "@shared/components/mario/PixelMarioBlocks";
import { SPRITE_SIZE } from "@shared/components/mario/mario-sprites";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrnamentSlot } from "../useOrnamentSlot";

/** 每个像素格 2.5px：一块砖 40px、整排 120px，比 Vivi 的 144 窄一点。 */
const MARIO_UNIT = 2.5;
const MARIO_BLOCK = SPRITE_SIZE * MARIO_UNIT;
/** 整排 120px，介于 Vivi（144/480）与星轨（96/360）之间，门槛也按宽度取中间一档。 */
const MARIO_MIN_SLOT_WIDTH = 420;
/** 顶没顶过记在本地：换台机器重新顶一次无所谓，不值得占一条设置项。 */
const MARIO_POPPED_STORAGE_KEY = "vetta-new-session-mario-popped";

interface MarioOrnamentProps {
	autoplay: boolean;
	mounted: boolean;
}

/**
 * 马里奥装饰件：一排插在输入框右上角的像素砖块，顶一下中间的问号砖块蹦出蘑菇，
 * 再顶一下把蘑菇收回去。
 *
 * 与 Vivi / 星轨同一套插槽约定：容器锚在 hero 上、下探 75px（hero mb-3 + 选项行 h-7 +
 * 行 mb-4 = 56，再加 19），所以 `bottom-[19px]` 正好让整排砖块坐在输入框顶边上，不进框。
 * 命中区只盖住中间那块问号砖：两侧的砖块在游戏里也顶不出东西来，给它们做成可点的会骗人。
 */
export function MarioOrnament({ autoplay, mounted }: MarioOrnamentProps): JSX.Element {
	const { t } = useTranslation("chat");
	const reduceMotion = useReducedMotion();
	const [popped, setPopped] = useState(readMarioPopped);
	const slot = useOrnamentSlot(MARIO_MIN_SLOT_WIDTH);

	const handleHit = useCallback(() => {
		setPopped((current) => {
			const next = !current;
			window.localStorage.setItem(MARIO_POPPED_STORAGE_KEY, String(next));
			return next;
		});
	}, []);

	// 关掉「头像动效」或系统要求减少动效时，蘑菇直接就位，不再蹦。
	const springy = autoplay && !reduceMotion;

	return (
		<motion.div
			initial={{ opacity: 0 }}
			animate={{ opacity: mounted ? 1 : 0 }}
			transition={{ duration: 0.5, delay: 0.2 }}
			className="pointer-events-none absolute inset-x-0 -bottom-[75px] z-30 h-20 select-none"
			ref={slot.ref}
		>
			{slot.visible ? (
				<div className="absolute right-2 bottom-[19px] flex">
					<PixelMarioBlocks animate={springy} popped={popped} unit={MARIO_UNIT} />
					{/* 透明命中区盖在问号砖块上：砖块本身是 SVG，直接当按钮会把焦点框描成方框外一圈。 */}
					<button
						aria-label={t(popped ? "newSession.mario.reset" : "newSession.mario.hit")}
						aria-pressed={popped}
						className="no-drag pointer-events-auto absolute bottom-0 cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
						onClick={handleHit}
						style={{ height: MARIO_BLOCK, left: MARIO_BLOCK, width: MARIO_BLOCK }}
						type="button"
					/>
				</div>
			) : null}
		</motion.div>
	);
}

function readMarioPopped(): boolean {
	// 默认没顶过：一上来就把蘑菇挂在半空，会让人以为这是张贴图而不是能顶的砖块。
	return window.localStorage.getItem(MARIO_POPPED_STORAGE_KEY) === "true";
}
