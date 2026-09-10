import { cn } from "@shared/lib/utils";
import type { CSSProperties } from "react";
import "./PixelTorch.css";

export interface PixelTorchProps {
	/** 火焰立方体的边长（CSS 像素）；其余尺寸都按它等比推出来。 */
	readonly unit: number;
	/** 点着没有。熄灭时是一块焦炭，点亮时火焰换暖色、木柄被烤亮一档。 */
	readonly lit: boolean;
	/** 火光是否轻微跳动；系统要求减少动效时样式表里另有一道兜底。 */
	readonly animate?: boolean;
	readonly className?: string;
}

/** 每个面是 2×2 的格子，木柄每片侧面是 2×8。格子只有底色，配色全在样式表里按序号点名。 */
const FACE_CELLS = Array.from({ length: 4 }, (_, index) => index);
const SIDE_CELLS = Array.from({ length: 16 }, (_, index) => index);

function cells(keys: readonly number[]): JSX.Element[] {
	return keys.map((key) => <span key={key} />);
}

/**
 * 像素火把：CSS 3D 摆出来的等轴测火把，没有贴图也没有画布。
 *
 * 只画火把本身，不带交互与定位——点不点得着、摆在哪儿由用的人决定
 * （新会话页装饰件见 TorchOrnament，设置页预览卡直接给个小 unit）。
 * 纯装饰，对辅助技术整体隐藏。
 */
export function PixelTorch({ unit, lit, animate = false, className }: PixelTorchProps): JSX.Element {
	return (
		// 外层挂载点刻意不带任何自带样式，`className` 想怎么摆就怎么摆。
		// 别把 className 合到 .ns-torch 上：组件样式表没有分层，而 Tailwind 工具类在
		// utilities 层里——无层级的规则反而优先级更高，`.ns-torch{position:relative}`
		// 会把传进来的 absolute 压掉，定位类看着生效实则全跑偏。
		<span
			aria-hidden
			className={cn("inline-flex", className)}
			style={{ "--ns-torch-unit": `${unit}px` } as CSSProperties}
		>
			<span className="ns-torch" data-animate={animate ? "true" : "false"} data-lit={lit ? "true" : "false"}>
				<span className="ns-torch-head">
					<span className="ns-torch-face ns-torch-face-top">{cells(FACE_CELLS)}</span>
					<span className="ns-torch-face ns-torch-face-left">{cells(FACE_CELLS)}</span>
					<span className="ns-torch-face ns-torch-face-right">{cells(FACE_CELLS)}</span>
				</span>
				<span className="ns-torch-stick">
					<span className="ns-torch-side ns-torch-side-left">{cells(SIDE_CELLS)}</span>
					<span className="ns-torch-side ns-torch-side-right">{cells(SIDE_CELLS)}</span>
				</span>
			</span>
		</span>
	);
}
