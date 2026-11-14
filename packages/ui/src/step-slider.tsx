import type { CSSProperties, JSX } from "react";
import { Button } from "./button";
import { Slider } from "./slider";
import { cn } from "./utils";

export interface StepSliderProps {
	/** 每一档的文字，显示在轨道下方，点击直接跳到该档。 */
	labels: readonly string[];
	/** 当前（含拖动中预览）所在档的下标。 */
	index: number;
	disabled?: boolean;
	/** 在轨道上画出中间各档的刻度点（首尾与把手所在档不画）。 */
	showTicks?: boolean;
	/**
	 * 轨道占满整宽：首个标签左对齐、末个右对齐、其余按位置排布。
	 * 缺省时轨道两端缩进半档，使端点正对首尾标签的中心（标签等分各占一列）。
	 */
	fullWidth?: boolean;
	"aria-label"?: string;
	"aria-valuetext"?: string;
	/** 拖动经过某一档时触发（吸附后的下标）。 */
	onIndexChange?: (index: number) => void;
	/** 松手、点击标签或键盘操作后触发。 */
	onIndexCommit: (index: number) => void;
	/** 拖动被系统打断（pointercancel）。 */
	onCancel?: () => void;
}

/**
 * 吸附到离散档位的滑块。
 *
 * 档位是数据的形状而不是外观细节：把连续区间切成一列明确落点，用户不必猜拖到哪儿
 * 会落在哪个值。`onIndexChange` 与 `onIndexCommit` 分开，拖动手感与提交时机由调用方
 * 决定（设置页要求松手才生效，预览只改本地状态）。
 */
export function StepSlider({
	labels,
	index,
	disabled,
	showTicks,
	fullWidth,
	"aria-label": ariaLabel,
	"aria-valuetext": ariaValueText,
	onIndexChange,
	onIndexCommit,
	onCancel,
}: StepSliderProps): JSX.Element {
	const last = Math.max(0, labels.length - 1);
	const slider = (
		<div className="relative" onPointerCancelCapture={onCancel}>
			<Slider
				value={[index]}
				min={0}
				max={last}
				step={1}
				animateValue
				className="data-[disabled]:opacity-100"
				disabled={disabled || labels.length < 2}
				aria-label={ariaLabel}
				aria-valuetext={ariaValueText}
				onValueChange={([next]) => onIndexChange?.(next ?? index)}
				onValueCommit={([next]) => onIndexCommit(next ?? index)}
			/>
			{showTicks ? (
				<div aria-hidden className="pointer-events-none absolute inset-0">
					{labels.map((label, tick) =>
						// 首尾两档贴着轨道端头，当前档被把手压住，都不画点。
						tick === 0 || tick === last || tick === index ? null : (
							<span
								key={label}
								className="absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background/70"
								style={{ left: `${(tick / last) * 100}%` }}
							/>
						),
					)}
				</div>
			) : null}
		</div>
	);
	const labelButton = (label: string, tick: number, extraClassName: string, style?: CSSProperties) => (
		<Button
			key={label}
			variant="ghost"
			size="sm"
			className={cn(
				"h-6 min-w-0 text-[11px] disabled:opacity-100",
				index === tick && "text-primary",
				extraClassName,
			)}
			style={style}
			disabled={disabled}
			aria-pressed={index === tick}
			onClick={() => onIndexCommit(tick)}
		>
			{label}
		</Button>
	);

	if (fullWidth) {
		return (
			<div>
				{slider}
				<div className="relative h-6">
					{labels.map((label, tick) => {
						// left 与 translateX 用同一个百分比：首个贴左缘、末个贴右缘，中间平滑过渡到居中。
						const percent = last === 0 ? 0 : (tick / last) * 100;
						return labelButton(label, tick, "absolute top-0 px-1.5", {
							left: `${percent}%`,
							transform: `translateX(-${percent}%)`,
						});
					})}
				</div>
			</div>
		);
	}

	return (
		<div className="grid" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}>
			<div className="col-span-full" style={{ marginInline: `${50 / labels.length}%` }}>
				{slider}
			</div>
			{labels.map((label, tick) => labelButton(label, tick, "px-0"))}
		</div>
	);
}
