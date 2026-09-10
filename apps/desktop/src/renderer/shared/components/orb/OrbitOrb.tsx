import { resolvedThemeAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import type { OrbState } from "./orbkit-core";
import { Shdr25 } from "./shdr-25";

export interface OrbitOrbProps {
	/** 直径（CSS 像素）。 */
	readonly size: number;
	/**
	 * 形态。`idle` 是慢火沸腾的静息态；`speaking` 折叠最深、只有最陡的棱发亮，
	 * 球体鼓成近半球、曝光三倍——用来做「被指到了」这类强反馈。
	 */
	readonly state?: OrbState;
	/** 停在当前帧。跟随「头像动效」偏好；着色器自己另会遵守 prefers-reduced-motion。 */
	readonly paused?: boolean;
	readonly className?: string;
}

/**
 * 浅色模式的配色反转：蓝球白纹。
 *
 * 着色器默认是「近黑球体 + 冷钢折痕」，深色底上成立，白底上却只剩一团灰蒙蒙的脏斑。
 * 这里把两者对调——球体本身给饱和的蓝（`body` 配上 10 倍的 `floorLevel`，默认那点
 * 底色亮度撑不起一整枚球），折痕改用纯白，于是白纹浮在蓝面上。
 *
 * 另外三处是白底逼出来的：
 * - `fringe` 压到近乎不错相位、`saturation` 收回 1：三通道各错开相位会在折痕两侧分出
 *   一暖一冷两条彩边，蓝白配色下那几道暖边直接糊成褐斑。
 * - `exposure` 调高、`edgeGain` 调低：只让最陡的棱发亮，否则白纹铺满整枚球，边缘直接
 *   化进白底、球没了轮廓。
 * - `sheen` 换成更深的蓝、`rim` 拉到 1.8：菲涅尔边原本是加亮的，白底上等于把轮廓擦掉；
 *   改成往边缘加深蓝，轮廓才收得住。
 */
const LIGHT_TUNING = {
	fringe: 0.02,
	saturation: 1,
	floorLevel: 1.6,
	exposure: 2,
	edgeGain: 6,
	rim: 1.8,
	light: 0.3,
} as const;

const LIGHT_COLORS = { tint: "#ffffff", body: "#1f4bb0", sheen: "#123a99" } as const;

/**
 * 三态同调：`fringe`、`exposure` 这些在 thinking/speaking 的预设里另有取值，只调 idle
 * 会让 hover 一上去又跳回深色底的那套。按键合并，两态的折叠深浅、球体鼓胀照旧，
 * 形态差异本来就不是靠颜色区分的。
 */
const LIGHT_STATE_PRESETS = {
	idle: LIGHT_TUNING,
	thinking: LIGHT_TUNING,
	speaking: LIGHT_TUNING,
} as const;

const LIGHT_STATE_COLORS = {
	idle: LIGHT_COLORS,
	thinking: LIGHT_COLORS,
	speaking: LIGHT_COLORS,
} as const;

/**
 * 星轨：一枚自转的着色器球，新会话页的装饰件之一。
 *
 * 只固定尺寸、暂停语义与两套外观的配色。颜色是 GL uniform 而不是 CSS 变量，硬塞主题
 * token 只会多一条读不到的取色路径，所以深色沿用着色器自带的冷钢/靛蓝，浅色经
 * `statePresets` / `stateColors` 整体换成蓝球白纹（见 `LIGHT_TUNING`）。
 * 装饰件不承载信息，对辅助技术整体隐藏（`ariaLabel` 缺省即不暴露）。
 */
export function OrbitOrb({ size, state = "idle", paused = false, className }: OrbitOrbProps): JSX.Element {
	const light = useAtomValue(resolvedThemeAtom) === "light";

	return (
		<Shdr25
			size={size}
			state={state}
			paused={paused}
			className={className}
			statePresets={light ? LIGHT_STATE_PRESETS : undefined}
			stateColors={light ? LIGHT_STATE_COLORS : undefined}
		/>
	);
}
