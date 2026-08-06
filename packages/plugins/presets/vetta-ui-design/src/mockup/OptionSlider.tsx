import { type JSX, useRef, useState } from "react";

interface OptionSliderProps {
	label: string;
	/** Right-aligned readout, styled like the host's agent settings slider. */
	display: string;
	value: number;
	min: number;
	max: number;
	step?: number;
	onChange(next: number): void;
}

/**
 * Track-and-pill slider matching the host's agent settings (image count).
 * Rebuilt locally rather than imported from @vetta/ui: plugin CSS is compiled
 * from this package's sources only, so classes living outside it never get
 * generated.
 */
export function OptionSlider({ label, display, value, min, max, step = 1, onChange }: OptionSliderProps): JSX.Element {
	const [dragging, setDragging] = useState(false);
	const [focused, setFocused] = useState(false);
	const draggingRef = useRef(false);
	const percent = max <= min ? 0 : Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));

	const updateFromPointer = (element: HTMLDivElement, clientX: number): void => {
		const rect = element.getBoundingClientRect();
		if (rect.width <= 0) return;
		const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
		const stepped = min + Math.round((ratio * (max - min)) / step) * step;
		onChange(Math.min(max, Math.max(min, stepped)));
	};

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-baseline justify-between gap-2">
				<span className="text-xs text-muted-foreground">{label}</span>
				<span className="shrink-0 text-xs font-semibold tabular-nums text-primary">{display}</span>
			</div>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: the range input inside carries the semantics */}
			<div
				className="relative flex h-5 w-full cursor-pointer touch-none select-none items-center"
				onPointerDown={(event) => {
					if (event.button !== 0) return;
					event.preventDefault();
					draggingRef.current = true;
					setDragging(true);
					event.currentTarget.setPointerCapture(event.pointerId);
					updateFromPointer(event.currentTarget, event.clientX);
				}}
				onPointerMove={(event) => {
					if (!draggingRef.current) return;
					updateFromPointer(event.currentTarget, event.clientX);
				}}
				onPointerUp={(event) => {
					if (!draggingRef.current) return;
					draggingRef.current = false;
					setDragging(false);
					event.currentTarget.releasePointerCapture(event.pointerId);
				}}
				onPointerCancel={() => {
					draggingRef.current = false;
					setDragging(false);
				}}
			>
				<div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-muted-foreground/20">
					<div className="absolute left-0 h-full bg-primary" style={{ width: `${percent}%` }} />
				</div>
				<div
					className={`pointer-events-none absolute top-1/2 w-1 rounded-full bg-primary ring-background transition-[height,box-shadow] ${
						dragging ? "h-5 ring-4" : focused ? "h-4 ring-[3px]" : "h-4 ring-2"
					}`}
					style={{ left: `${percent}%`, transform: "translate(-50%, -50%)" }}
				/>
				<input
					type="range"
					value={value}
					min={min}
					max={max}
					step={step}
					aria-label={label}
					onChange={(event) => onChange(Number(event.currentTarget.value))}
					onFocus={() => setFocused(true)}
					onBlur={() => setFocused(false)}
					className="absolute inset-0 h-full w-full cursor-grab opacity-0 active:cursor-grabbing"
				/>
			</div>
		</div>
	);
}
