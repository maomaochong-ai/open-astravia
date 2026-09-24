import { Button, Slider } from "@vetta-org/ui";
import type { JSX } from "react";
import { useEffect, useState } from "react";

export function ReasoningStepSlider({
	label,
	value,
	levels,
	levelLabel,
	disabled,
	onChange,
}: {
	readonly label: string;
	readonly value: string;
	readonly levels: readonly string[];
	readonly levelLabel: (level: string) => string;
	readonly disabled: boolean;
	readonly onChange: (level: string) => Promise<void> | void;
}): JSX.Element {
	const [draftIndex, setDraftIndex] = useState<number>();
	const levelsKey = levels.join("\u0000");
	useEffect(() => setDraftIndex(undefined), [value, levelsKey]);
	const currentIndex = Math.max(0, levels.indexOf(value));
	const previewIndex = draftIndex ?? currentIndex;
	const previewLevel = levels[previewIndex];

	function commit(index: number) {
		if (disabled) return;
		const level = levels[index];
		if (!level || level === value) {
			setDraftIndex(undefined);
			return;
		}
		setDraftIndex(index);
		void Promise.resolve(onChange(level)).then(
			() => setDraftIndex(undefined),
			() => setDraftIndex(undefined),
		);
	}

	return (
		<div role="group" aria-label={label} className="space-y-2 border-b border-border/50 pb-3">
			<div className="flex items-center justify-between gap-2 text-[12px]">
				<span>{label}</span>
				<span className="font-medium text-foreground" aria-live="polite">
					{previewLevel ? levelLabel(previewLevel) : null}
				</span>
			</div>
			<div className="grid" style={{ gridTemplateColumns: `repeat(${levels.length}, minmax(0, 1fr))` }}>
				<div
					className="col-span-full"
					onPointerCancelCapture={() => setDraftIndex(undefined)}
					style={{ marginInline: `${50 / levels.length}%` }}
				>
					<Slider
						value={[previewIndex]}
						min={0}
						max={Math.max(0, levels.length - 1)}
						step={1}
						animateValue
						className="data-[disabled]:opacity-100"
						disabled={disabled || levels.length < 2}
						aria-label={label}
						aria-valuetext={previewLevel ? levelLabel(previewLevel) : undefined}
						onValueChange={([index]) => setDraftIndex(index)}
						onValueCommit={([index]) => commit(index ?? currentIndex)}
					/>
				</div>
				{levels.map((level, index) => (
					<Button
						key={level}
						variant="ghost"
						size="sm"
						className={
							previewIndex === index
								? "h-6 min-w-0 px-0 text-[11px] text-primary disabled:opacity-100"
								: "h-6 min-w-0 px-0 text-[11px] disabled:opacity-100"
						}
						disabled={disabled}
						aria-pressed={previewIndex === index}
						onClick={() => commit(index)}
					>
						{levelLabel(level)}
					</Button>
				))}
			</div>
		</div>
	);
}
