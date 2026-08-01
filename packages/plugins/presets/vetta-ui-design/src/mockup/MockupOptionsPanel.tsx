import { useTranslation } from "@vetta-org/plugin-sdk";
import type { ReactNode } from "react";
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

function Field({ label, value, children }: { label: string; value?: string; children: ReactNode }) {
	return (
		<label className="flex flex-col gap-1.5">
			<span className="flex items-center justify-between text-xs text-muted-foreground">
				{label}
				{value ? <span className="tabular-nums">{value}</span> : null}
			</span>
			{children}
		</label>
	);
}

function ColorField({
	label,
	color,
	palette,
	disabled,
	onPick,
}: {
	label: string;
	color: string;
	palette: string[];
	disabled?: boolean;
	onPick(next: string): void;
}) {
	return (
		<Field label={label}>
			<div className={`flex items-center gap-1.5 ${disabled ? "opacity-40" : ""}`}>
				<input
					type="color"
					value={color}
					disabled={disabled}
					onChange={(event) => onPick(event.target.value)}
					className="size-7 shrink-0 cursor-pointer rounded-md border border-border bg-transparent"
				/>
				<div className="flex min-w-0 flex-1 flex-wrap gap-1">
					{palette.map((swatch) => (
						<button
							key={swatch}
							type="button"
							disabled={disabled}
							title={swatch}
							onClick={() => onPick(swatch)}
							style={{ background: swatch }}
							className={`size-5 rounded-md border ${
								swatch.toLowerCase() === color.toLowerCase() ? "border-primary ring-1 ring-primary" : "border-border"
							}`}
						/>
					))}
				</div>
			</div>
		</Field>
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
			<Field label={t("mockup.option.radius")} value={`${Math.round(options.radius)}`}>
				<input
					type="range"
					min={0}
					max={Math.max(8, Math.round(maxRadius))}
					value={Math.round(options.radius)}
					onChange={(event) => onChange({ radius: Number(event.target.value) })}
					className="w-full accent-[var(--primary)]"
				/>
			</Field>

			<Field label={t("mockup.option.border")} value={`${options.borderWidth}`}>
				<input
					type="range"
					min={0}
					max={48}
					value={options.borderWidth}
					onChange={(event) => onChange({ borderWidth: Number(event.target.value) })}
					className="w-full accent-[var(--primary)]"
				/>
			</Field>

			<ColorField
				label={t("mockup.option.borderColor")}
				color={options.borderColor}
				palette={palette}
				disabled={options.borderWidth === 0}
				onPick={(borderColor) => onChange({ borderColor })}
			/>

			<ColorField
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
