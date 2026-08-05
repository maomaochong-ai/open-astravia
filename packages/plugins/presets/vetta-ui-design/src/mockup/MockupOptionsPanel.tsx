import { useTranslation } from "@vetta-org/plugin-sdk";
import type { ReactNode } from "react";
import { ColorPicker } from "./ColorPicker";
import { OptionSlider } from "./OptionSlider";
import type { MockupOptions } from "./types";

interface MockupOptionsPanelProps {
	options: MockupOptions;
	/** Upper bound for the radius slider — half the normalized height. */
	maxRadius: number;
	/** Swatches pulled from the design's own theme.css tokens. */
	palette: string[];
	onChange(patch: Partial<MockupOptions>): void;
	onReset(): void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<label className="flex flex-col gap-1.5">
			<span className="text-xs text-muted-foreground">{label}</span>
			{children}
		</label>
	);
}

function Toggle({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange(next: boolean): void;
}) {
	return (
		<label className="flex cursor-pointer items-center justify-between gap-2 text-xs text-foreground">
			{label}
			<input
				type="checkbox"
				checked={checked}
				onChange={(event) => onChange(event.target.checked)}
				className="size-4 cursor-pointer accent-[var(--primary)]"
			/>
		</label>
	);
}

/** Right-hand settings column of the export dialog. */
export function MockupOptionsPanel({ options, maxRadius, palette, onChange, onReset }: MockupOptionsPanelProps) {
	const { t } = useTranslation();
	return (
		<div className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border p-4">
			<OptionSlider
				label={t("mockup.option.radius")}
				display={`${Math.round(options.radius)}`}
				value={Math.round(options.radius)}
				min={0}
				max={Math.max(8, Math.round(maxRadius))}
				onChange={(radius) => onChange({ radius })}
			/>

			<OptionSlider
				label={t("mockup.option.border")}
				display={`${options.borderWidth}`}
				value={options.borderWidth}
				min={0}
				max={48}
				onChange={(borderWidth) => onChange({ borderWidth })}
			/>

			<ColorPicker
				label={t("mockup.option.borderColor")}
				color={options.borderColor}
				palette={palette}
				disabled={options.borderWidth === 0}
				onPick={(borderColor) => onChange({ borderColor })}
			/>

			<ColorPicker
				label={t("mockup.option.background")}
				color={options.background}
				palette={palette}
				disabled={options.transparent}
				onPick={(background) => onChange({ background })}
			/>

			<div className="flex flex-col gap-2.5 rounded-lg border border-border p-2.5">
				<Toggle
					label={t("mockup.option.transparent")}
					checked={options.transparent}
					onChange={(transparent) => onChange({ transparent })}
				/>
				<Toggle label={t("mockup.option.shadow")} checked={options.shadow} onChange={(shadow) => onChange({ shadow })} />
				<Toggle label={t("mockup.option.brand")} checked={options.brand} onChange={(brand) => onChange({ brand })} />
			</div>

			<Field label={t("mockup.option.scale")}>
				<div className="flex gap-1">
					{([1, 2] as const).map((value) => (
						<button
							key={value}
							type="button"
							onClick={() => onChange({ scale: value })}
							className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
								options.scale === value
									? "bg-primary text-primary-foreground"
									: "text-muted-foreground hover:bg-accent"
							}`}
						>
							{value}x
						</button>
					))}
				</div>
			</Field>

			<button
				type="button"
				onClick={onReset}
				className="mt-auto rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent"
			>
				{t("mockup.option.reset")}
			</button>
		</div>
	);
}
