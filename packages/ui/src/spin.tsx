import * as React from "react";
import { cn } from "./utils";

/**
 * 全局统一的加载指示器：两颗小球黏连、分离、整体旋转的「果冻」效果。
 *
 * 黏连靠 SVG 的高斯模糊 + 对比度拉伸滤镜（feColorMatrix 把 alpha 拉到阈值外），
 * 两颗球靠近时模糊区域重叠、被拉伸成一体，看起来像液体粘在一起。
 *
 * 颜色取 `currentColor`，跟随所在容器的文字色，因此直接用主题类切换即可：
 * `<Spin className="text-primary" />` / `<Spin className="text-muted-foreground" />`。
 * 尺寸只暴露三档，避免各处随手写像素值导致视觉不统一。
 */

const SIZES = {
	sm: 16,
	md: 24,
	lg: 40,
} as const;

export type SpinSize = keyof typeof SIZES;

export interface SpinProps extends React.ComponentProps<"div"> {
	size?: SpinSize;
	/** 无障碍label；不传则整体对辅助技术隐藏（适合已有同义文案的场景）。 */
	label?: string;
}

/**
 * React 19 会按 href 去重并提升到 head，无论页面上有多少个 Spin，
 * 这段 keyframes 只会插入一次。
 */
function SpinKeyframes(): React.JSX.Element {
	return (
		<style href="@vetta/ui/spin" precedence="default">
			{`@keyframes vetta-spin-rotate{0%,49.999%,100%{transform:none}50%,99.999%{transform:rotate(90deg)}}` +
				`@keyframes vetta-spin-shift-left{0%,100%{transform:translateX(0)}50%{transform:scale(.65) translateX(-75%)}}` +
				`@keyframes vetta-spin-shift-right{0%,100%{transform:translateX(0)}50%{transform:scale(.65) translateX(75%)}}` +
				`.vetta-spin{position:relative;animation:vetta-spin-rotate calc(var(--vetta-spin-speed) * 2) linear infinite}` +
				`.vetta-spin::before,.vetta-spin::after{content:"";position:absolute;top:0;left:25%;width:50%;height:100%;background:currentColor;border-radius:100%}` +
				`.vetta-spin::before{animation:vetta-spin-shift-left var(--vetta-spin-speed) ease infinite}` +
				`.vetta-spin::after{animation:vetta-spin-shift-right var(--vetta-spin-speed) ease infinite}` +
				// 关掉动效时停在两球分离的静止态，避免只剩一个黏在一起的圆点看不出是加载中
				`@media (prefers-reduced-motion:reduce){` +
				`.vetta-spin{animation:none}` +
				`.vetta-spin::before{animation:none;transform:scale(.65) translateX(-75%)}` +
				`.vetta-spin::after{animation:none;transform:scale(.65) translateX(75%)}}`}
		</style>
	);
}

function Spin({ className, size = "md", label, style, ...props }: SpinProps): React.JSX.Element {
	// 每个实例一份 filter id：同页多个 Spin 时 id 不能撞。
	const filterId = `vetta-spin-ooze-${React.useId().replace(/:/g, "")}`;
	const width = SIZES[size];
	// 模糊半径随尺寸缩放，否则小尺寸会糊成一坨、大尺寸黏不起来。
	const blur = width * 0.156;

	return (
		<div
			data-slot="spin"
			role={label ? "status" : undefined}
			aria-label={label}
			aria-hidden={label ? undefined : true}
			className={cn("inline-flex shrink-0 items-center justify-center", className)}
			style={style}
			{...props}
		>
			<SpinKeyframes />
			<div
				className="vetta-spin"
				style={
					{
						"--vetta-spin-speed": "0.8s",
						width: `${width}px`,
						height: `${width / 2}px`,
						filter: `url(#${filterId})`,
					} as React.CSSProperties
				}
			/>
			<svg width={0} height={0} className="absolute h-0 w-0" aria-hidden="true">
				<title>spin</title>
				<defs>
					<filter id={filterId}>
						<feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="blur" />
						<feColorMatrix
							in="blur"
							mode="matrix"
							values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
							result="ooze"
						/>
						<feBlend in="SourceGraphic" in2="ooze" />
					</filter>
				</defs>
			</svg>
		</div>
	);
}

export { Spin };
