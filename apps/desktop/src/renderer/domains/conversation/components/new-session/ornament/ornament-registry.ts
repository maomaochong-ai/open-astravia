import type { OrnamentId } from "@shared/theme/ornament";
import type { ComponentType } from "react";
import { OrbitOrnament } from "./presets/OrbitOrnament";
import { ViviOrnament } from "./presets/ViviOrnament";

export interface OrnamentProps {
	/** 是否允许自动播放动画（跟随「头像动效」偏好）。 */
	autoplay: boolean;
	/** 页面入场是否完成，用于对齐 hero 的淡入节奏。 */
	mounted: boolean;
}

/**
 * 装饰件实现表：id → 组件。`null` 表示这一项不画任何东西（「无」）。
 *
 * 新增装饰件：在 `shared/theme/ornament.ts` 的目录里加一项（决定设置页怎么展示），
 * 再在这里挂上组件（决定新会话页怎么画）。两处都以 id 对齐，漏一处会有类型报错。
 */
export const ORNAMENT_COMPONENTS: Record<OrnamentId, ComponentType<OrnamentProps> | null> = {
	none: null,
	orbit: OrbitOrnament,
	vivi: ViviOrnament,
};
