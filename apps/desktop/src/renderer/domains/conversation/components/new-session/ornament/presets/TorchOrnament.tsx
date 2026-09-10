import { PixelTorch } from "@shared/components/torch/PixelTorch";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrnamentSlot } from "../useOrnamentSlot";

/** 火焰立方体边长：投影后约 25×90，与星轨那枚 96 的球同档，但窄得多。 */
const TORCH_UNIT = 18;
/** 火把只有 25px 宽，比星轨还窄一圈，收起门槛再往下放一档。 */
const TORCH_MIN_SLOT_WIDTH = 300;
/** 点没点着记在本地：换台机器重新点一次无所谓，不值得占一条设置项。 */
const TORCH_LIT_STORAGE_KEY = "vetta-new-session-torch-lit";

interface TorchOrnamentProps {
	autoplay: boolean;
	mounted: boolean;
}

/**
 * 火把装饰件：一枚插在输入框右上角的像素火把，点一下灭、再点一下重新点着。
 *
 * 与 Vivi / 星轨同一套插槽约定：容器锚在 hero 上、下探 75px（hero mb-3 + 选项行 h-7 +
 * 行 mb-4 = 56，再加 19）。但火把是 3D 投影，画出来的底边比元素盒底还高 6px，
 * 直接 `bottom-[19px]` 会让它悬在半空——补到 13px 才让柄底正好杵在输入框顶边上。
 * 这里在那个基准上左移 16px、下沉 8px（`right-7` / `bottom-[5px]`），
 * 让它从选项行让开、柄底压在框沿上，看着像插在那儿而不是浮在框上。
 */
export function TorchOrnament({ autoplay, mounted }: TorchOrnamentProps): JSX.Element {
	const { t } = useTranslation("chat");
	const reduceMotion = useReducedMotion();
	const [lit, setLit] = useState(readTorchLit);
	const slot = useOrnamentSlot(TORCH_MIN_SLOT_WIDTH);

	const handleToggle = useCallback(() => {
		setLit((current) => {
			const next = !current;
			window.localStorage.setItem(TORCH_LIT_STORAGE_KEY, String(next));
			return next;
		});
	}, []);

	// 关掉「头像动效」或系统要求减少动效时，火光停在最亮的一帧，不再跳动。
	const flickering = autoplay && !reduceMotion;

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
					aria-label={t(lit ? "newSession.torch.extinguish" : "newSession.torch.light")}
					aria-pressed={lit}
					className="no-drag pointer-events-auto absolute right-7 bottom-[5px] cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
					onClick={handleToggle}
					type="button"
				>
					<PixelTorch animate={flickering} lit={lit} unit={TORCH_UNIT} />
				</button>
			) : null}
		</motion.div>
	);
}

function readTorchLit(): boolean {
	// 默认点着：装饰件选了火把还给一根灭的，像是没加载出来。
	return window.localStorage.getItem(TORCH_LIT_STORAGE_KEY) !== "false";
}
