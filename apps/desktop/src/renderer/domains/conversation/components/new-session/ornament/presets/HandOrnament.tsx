import { PixelHand } from "@shared/components/hand/PixelHand";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrnamentSlot } from "../useOrnamentSlot";

/** 掌背宽 62px：连指节带拇指画出来 128×74，与马里奥那排砖块（120 宽）同档。 */
const HAND_UNIT = 62;
/** 画出来 128 宽，与马里奥同档，收起门槛也取同一档。 */
const HAND_MIN_SLOT_WIDTH = 420;
/** 敲还是不敲记在本地：换台机器重新点一下无所谓，不值得占一条设置项。 */
const HAND_TAPPING_STORAGE_KEY = "vetta-new-session-hand-tapping";

interface HandOrnamentProps {
	autoplay: boolean;
	mounted: boolean;
}

/**
 * 玩手装饰件：一只搭在输入框右上角敲手指的手，点一下收成拳头、再点一下继续敲。
 *
 * 与 Vivi / 星轨同一套插槽约定：容器锚在 hero 上、下探 75px（hero mb-3 + 选项行 h-7 +
 * 行 mb-4 = 56，再加 19），`bottom-[19px]` 让装饰件坐在输入框顶边上。
 * 但手掌的拇指与掌根是转过角度探到元素盒底下去的，实际画出来比盒底还低 24px：
 * 这 24px 交给按钮的下内边距撑开，而不是把 bottom 抬到 43px——抬 bottom 的话盒子跟着
 * 上移，露在外面的掌根就点不着了。
 */
export function HandOrnament({ autoplay, mounted }: HandOrnamentProps): JSX.Element {
	const { t } = useTranslation("chat");
	const reduceMotion = useReducedMotion();
	const [tapping, setTapping] = useState(readHandTapping);
	const slot = useOrnamentSlot(HAND_MIN_SLOT_WIDTH);

	const handleToggle = useCallback(() => {
		setTapping((current) => {
			const next = !current;
			window.localStorage.setItem(HAND_TAPPING_STORAGE_KEY, String(next));
			return next;
		});
	}, []);

	// 关掉「头像动效」或系统要求减少动效时，手指停在摊开的那一帧，但仍然收得起来。
	const drumming = autoplay && !reduceMotion;

	return (
		<motion.div
			initial={{ opacity: 0 }}
			animate={{ opacity: mounted ? 1 : 0 }}
			transition={{ duration: 0.5, delay: 0.2 }}
			className="pointer-events-none absolute inset-x-0 -bottom-[75px] z-30 h-20 select-none"
			ref={slot.ref}
		>
			{slot.visible ? (
				<button
					aria-label={t(tapping ? "newSession.hand.rest" : "newSession.hand.tap")}
					aria-pressed={tapping}
					className="no-drag pointer-events-auto absolute right-2 bottom-[19px] cursor-pointer rounded-sm pb-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
					onClick={handleToggle}
					type="button"
				>
					<PixelHand animate={drumming} tapping={tapping} unit={HAND_UNIT} />
				</button>
			) : null}
		</motion.div>
	);
}

function readHandTapping(): boolean {
	// 默认在敲：装饰件选了玩手还给一只不动的手，像是没加载出来。
	return window.localStorage.getItem(HAND_TAPPING_STORAGE_KEY) !== "false";
}
