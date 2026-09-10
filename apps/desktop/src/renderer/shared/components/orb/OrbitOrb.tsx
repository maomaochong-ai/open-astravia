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
 * 星轨：一枚自转的着色器球，新会话页的装饰件之一。
 *
 * 只固定尺寸与暂停语义，配色一律沿用着色器自带的冷钢/靛蓝——它是 GL uniform 而不是
 * CSS 变量，硬塞主题 token 只会多一条读不到的取色路径，深浅两套外观下这组颜色都成立。
 * 装饰件不承载信息，对辅助技术整体隐藏（`ariaLabel` 缺省即不暴露）。
 */
export function OrbitOrb({ size, state = "idle", paused = false, className }: OrbitOrbProps): JSX.Element {
	return <Shdr25 size={size} state={state} paused={paused} className={className} />;
}
