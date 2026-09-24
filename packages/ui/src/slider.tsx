import type { JSX } from "react";
import { useMemo, useRef, useState } from "react";
import { cn } from "./utils";

export interface SliderProps {
	className?: string;
	value?: number[];
	defaultValue?: number[];
	min?: number;
	max?: number;
	step?: number;
	disabled?: boolean;
	animateValue?: boolean;
	"aria-label"?: string;
	"aria-valuetext"?: string;
	onValueChange?: (value: number[]) => void;
	onValueCommit?: (value: number[]) => void;
}

export function Slider({
	className,
	value,
	defaultValue,
	min = 0,
	max = 100,
	step = 1,
	disabled,
	animateValue = false,
	"aria-label": ariaLabel,
	"aria-valuetext": ariaValueText,
	onValueChange,
	onValueCommit,
}: SliderProps): JSX.Element {
	const [internalValue, setInternalValue] = useState(() => defaultValue?.[0] ?? value?.[0] ?? min);
	const [dragging, setDragging] = useState(false);
	const [scrubbing, setScrubbing] = useState(false);
	const [focused, setFocused] = useState(false);
	const draggingRef = useRef(false);
	const pointerStartX = useRef(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const current = value?.[0] ?? internalValue;
	const percent = useMemo(() => {
		if (max <= min) return 0;
		return Math.min(100, Math.max(0, ((current - min) / (max - min)) * 100));
	}, [current, min, max]);

	const changeValue = (next: number): number => {
		const clamped = Math.min(max, Math.max(min, next));
		setInternalValue(clamped);
		onValueChange?.([clamped]);
		return clamped;
	};

	const updateFromPointer = (element: HTMLDivElement, clientX: number): number | undefined => {
		const rect = element.getBoundingClientRect();
		if (rect.width <= 0) return undefined;
		const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
		const raw = min + ratio * (max - min);
		const stepped = min + Math.round((raw - min) / step) * step;
		const decimals = step.toString().split(".")[1]?.length ?? 0;
		return changeValue(Number(stepped.toFixed(decimals)));
	};

	return (
		<div
			data-slot="slider"
			data-disabled={disabled ? "" : undefined}
			onPointerDown={(event) => {
				if (disabled || event.button !== 0) return;
				event.preventDefault();
				inputRef.current?.focus();
				draggingRef.current = true;
				pointerStartX.current = event.clientX;
				setDragging(true);
				event.currentTarget.setPointerCapture(event.pointerId);
				updateFromPointer(event.currentTarget, event.clientX);
			}}
			onPointerMove={(event) => {
				if (!draggingRef.current) return;
				if (Math.abs(event.clientX - pointerStartX.current) >= 4) setScrubbing(true);
				updateFromPointer(event.currentTarget, event.clientX);
			}}
			onPointerUp={(event) => {
				if (!draggingRef.current) return;
				const next = updateFromPointer(event.currentTarget, event.clientX);
				draggingRef.current = false;
				setDragging(false);
				setScrubbing(false);
				event.currentTarget.releasePointerCapture(event.pointerId);
				onValueCommit?.([next ?? current]);
			}}
			onPointerCancel={() => {
				draggingRef.current = false;
				setDragging(false);
				setScrubbing(false);
			}}
			className={cn(
				"relative flex h-5 w-full cursor-pointer touch-none select-none items-center data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
				className,
			)}
		>
			<div
				data-slot="slider-track"
				className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-muted-foreground/20"
			>
				<div
					data-slot="slider-range"
					className={cn(
						"absolute h-full bg-primary",
						animateValue && !scrubbing
							? "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
							: undefined,
					)}
					style={{ left: 0, width: `${percent}%` }}
				/>
			</div>
			<div
				data-slot="slider-thumb"
				className={cn(
					"pointer-events-none absolute top-1/2 block size-4 shrink-0 rounded-full border border-primary bg-popover outline-none ring-1 ring-primary/40",
					animateValue && !scrubbing
						? "transition-[left,background-color,box-shadow] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
						: "transition-colors",
					dragging || focused ? "bg-primary ring-ring" : undefined,
				)}
				style={{ left: `${percent}%`, transform: "translate(-50%, -50%)" }}
			/>
			<input
				ref={inputRef}
				type="range"
				value={current}
				min={min}
				max={max}
				step={step}
				disabled={disabled}
				aria-label={ariaLabel}
				aria-valuetext={ariaValueText}
				onKeyDown={(event) => {
					let next: number;
					if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = current - step;
					else if (event.key === "ArrowRight" || event.key === "ArrowUp") next = current + step;
					else if (event.key === "Home") next = min;
					else if (event.key === "End") next = max;
					else if (event.key === "PageDown") next = current - step * 10;
					else if (event.key === "PageUp") next = current + step * 10;
					else return;
					event.preventDefault();
					const committed = changeValue(next);
					onValueCommit?.([committed]);
				}}
				onChange={(event) => {
					const next = changeValue(Number(event.currentTarget.value));
					onValueCommit?.([next]);
				}}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
			/>
		</div>
	);
}
