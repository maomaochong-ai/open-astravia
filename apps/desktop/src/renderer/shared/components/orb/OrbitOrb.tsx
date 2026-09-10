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
 * 浅色模式的配色反转：白球蓝纹。
 *
 * 着色器默认是「近黑球体 + 冷钢折痕」，深色底上成立，白底上却只剩一团灰蒙蒙的脏斑。
 * 这里把两者对调——但着色器是加色的，折痕只会比球体更亮，想要「白球上浮着蓝纹」就得先
 * 把场反相（`invert`）：平面吃 `tint` 的白，折痕留下 `body` 那层蓝底，蓝纹才是暗的那一半。
 *
 * 另外几处是白底逼出来的：
 * - `fringe` 压到近乎不错相位、`saturation` 收回 1：三通道各错开相位会在折痕两侧分出
 *   一暖一冷两条彩边，蓝白配色下那几道暖边直接糊成褐斑。
 * - `tint` 不是纯白、`floorLevel` 只有 0.6：两层是相加的，球面白得撑满就把蓝纹一起顶到
 *   过曝，白纹时代那种「白到底」的取值在这边只会压成一颗没有花纹的白珠。
 * - `light` 抬到 0.6：兰伯特是这套配色里唯一还在给球体做明暗的项，淡蓝纹本身对比很弱，
 *   球得靠打光才鼓得起来。
 * - `sheen` 用蓝、`rim` 拉到 1.3：菲涅尔边原本是加亮的，白球在白底上等于没有轮廓；
 *   改成往边缘加蓝，轮廓才收得住。
 */
const LIGHT_TUNING = {
	invert: 1,
	fringe: 0.02,
	saturation: 1,
	floorLevel: 0.6,
	exposure: 0.8,
	edgeGain: 12.5,
	rim: 1.3,
	light: 0.6,
} as const;

const LIGHT_COLORS = { tint: "#c3d0e2", body: "#86a9ee", sheen: "#3f6ecb" } as const;

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
 * `statePresets` / `stateColors` 整体换成白球蓝纹（见 `LIGHT_TUNING`）。
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
