import { cn } from "@shared/lib/utils";
import type { CSSProperties } from "react";
import "./PixelHand.css";

export interface PixelHandProps {
	/** 手指是否真的敲起来；系统要求减少动效时样式表里另有一道兜底。 */
	readonly animate?: boolean;
	readonly className?: string;
	/** 在敲桌面还是收成拳头。收起来时手指折进掌心，接触阴影也跟着淡下去。 */
	readonly tapping: boolean;
	/** 掌背宽度（CSS 像素）；其余尺寸都按它等比推出来。 */
	readonly unit: number;
}

/** 四根手指靠 nth-child 分层次与快慢，这里只负责按顺序把它们摆出来。 */
const FINGERS = [0, 1, 2, 3];

/**
 * 玩手：一只搭在桌沿上、四根手指依次敲着的手，纯 CSS 盒子摆出来的。
 *
 * 只画手本身，不带交互与定位——敲不敲、摆在哪儿由用的人决定（新会话页装饰件见
 * HandOrnament，设置页预览卡直接给个小 unit）。纯装饰，对辅助技术整体隐藏。
 */
export function PixelHand({ animate = false, className, tapping, unit }: PixelHandProps): JSX.Element {
	return (
		// 外层挂载点刻意不带任何自带样式，`className` 想怎么摆就怎么摆。
		// 别把 className 合到 .ns-hand 上：组件样式表没有分层，而 Tailwind 工具类在
		// utilities 层里——无层级的规则反而优先级更高，`.ns-hand{position:relative}`
		// 会把传进来的 absolute 压掉，定位类看着生效实则全跑偏。
		<span
			aria-hidden
			className={cn("inline-flex", className)}
			style={{ "--ns-hand-unit": `${unit}px` } as CSSProperties}
		>
			<span
				className="ns-hand"
				data-animate={animate ? "true" : "false"}
				data-tapping={tapping ? "true" : "false"}
			>
				{FINGERS.map((finger) => (
					<span className="ns-hand-finger" key={finger} />
				))}
				<span className="ns-hand-palm" />
				<span className="ns-hand-thumb" />
			</span>
		</span>
	);
}
