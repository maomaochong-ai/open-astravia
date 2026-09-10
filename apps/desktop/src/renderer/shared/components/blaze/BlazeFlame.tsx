import { cn } from "@shared/lib/utils";
import type { CSSProperties } from "react";
import { useId } from "react";
import "./BlazeFlame.css";

export interface BlazeFlameProps {
	/** 火团直径（CSS 像素）；内部按 100×100 的原始坐标系等比缩放。 */
	readonly size: number;
	/** 火苗是否翻动；系统要求减少动效时样式表里另有一道兜底。 */
	readonly animate?: boolean;
	readonly className?: string;
}

/** mask 里的六片火舌：靠 nth-child 在样式表里各自点名转轴与相位，这里只管形状。 */
const FLAME_SHAPES = [
	"25,25 75,25 50,75",
	"50,25 75,75 25,75",
	"35,35 65,35 50,65",
	"35,35 65,35 50,65",
	"35,35 65,35 50,65",
	"35,35 65,35 50,65",
] as const;

/**
 * 燃烧：一团烧在暖色光晕里的火苗，新会话页的装饰件之一。
 *
 * 只画火，不带交互与定位——摆在哪儿由用的人决定（新会话页装饰件见 BlazeOrnament，
 * 设置页预览卡直接给个小 size）。纯装饰，对辅助技术整体隐藏。
 *
 * 配色沿用素材自带的暖黄/暗红，不换成主题 token：这团东西的辨识度全在这组颜色上，
 * 且深浅两套外观下都成立。
 */
export function BlazeFlame({ size, animate = false, className }: BlazeFlameProps): JSX.Element {
	// mask 靠 id 引用，页面上可能同时有多枚（设置页预览卡就并排好几张），
	// 写死 id 会让后挂上的那份把先前的遮罩抢走。useId 带冒号，CSS 的 url() 认不了，去掉。
	const maskId = `ns-blaze-mask-${useId().replace(/:/g, "")}`;

	return (
		// 外层挂载点只负责占位与接 className：组件样式表没有分层，而 Tailwind 工具类在
		// utilities 层里，把 className 合到 .ns-blaze 上会让传进来的定位类被压掉。
		<span
			aria-hidden
			className={cn("inline-flex", className)}
			// 这个变量给的是无单位数字，样式表里要拿它算 scale()，见 BlazeFlame.css。
			style={{ "--ns-blaze-size": String(size) } as CSSProperties}
		>
			<span className="ns-blaze-root">
				<span className="ns-blaze" data-animate={animate ? "true" : "false"}>
					<svg className="ns-blaze-mask" width={100} height={100} viewBox="0 0 100 100">
						<defs>
							<mask className="ns-blaze-clip" id={maskId}>
								{/* 整块底板是黑的（全遮），白色的火舌才是露出来的部分。 */}
								<polygon points="0,0 100,0 100,100 0,100" fill="black" />
								{FLAME_SHAPES.map((points, index) => (
									// 形状有重复，位置本身就是身份：这几片只由 nth-child 区分。
									<polygon key={index} points={points} fill="white" />
								))}
							</mask>
						</defs>
					</svg>
					<span className="ns-blaze-body" style={{ mask: `url(#${maskId})`, WebkitMask: `url(#${maskId})` }} />
				</span>
			</span>
		</span>
	);
}
