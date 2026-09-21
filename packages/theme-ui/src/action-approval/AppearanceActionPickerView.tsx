import type { JSX, MouseEvent, ReactNode } from "react";
import { cn } from "./cn";

export type AppearanceThemeMode = "light" | "dark" | "auto";

export interface AppearanceThemePalettePreview {
	readonly primary: string;
	readonly accent: string;
	readonly ring: string;
	readonly chart1: string;
	readonly chart2: string;
	readonly background: string;
	readonly card: string;
	readonly border: string;
	readonly destructive: string;
	readonly foreground: string;
	readonly mutedForeground: string;
}

export interface AppearanceThemePreview {
	readonly id: string;
	readonly label: string;
	readonly dark: AppearanceThemePalettePreview;
}

export interface AppearanceModeOption {
	readonly value: AppearanceThemeMode;
	readonly label: string;
	readonly icon: string;
	readonly hint: string;
}

export interface AppearanceCursorOption {
	readonly value: string;
	readonly label: string;
	readonly hint: string;
	readonly icon?: string;
	readonly preview?: string;
}

export interface AppearanceActionPickerViewLabels {
	readonly modeSection: string;
	readonly themeSection: string;
	readonly cursorSection: string;
}

export interface AppearanceActionPickerViewProps {
	readonly mode: AppearanceThemeMode;
	readonly themeId: string;
	readonly cursorStyle: string;
	readonly themes: readonly AppearanceThemePreview[];
	readonly modes: readonly AppearanceModeOption[];
	readonly cursors: readonly AppearanceCursorOption[];
	readonly labels: AppearanceActionPickerViewLabels;
	readonly onModeChange: (mode: AppearanceThemeMode) => void;
	readonly onThemeChange: (themeId: string) => void;
	readonly onCursorStyleChange: (style: string) => void;
}

const BLOB_LAYOUT: { left: string; top: string; w: string; h: string; rotate: number }[] = [
	{ left: "-15%", top: "-20%", w: "75%", h: "75%", rotate: -8 },
	{ left: "55%", top: "-15%", w: "70%", h: "70%", rotate: 12 },
	{ left: "-10%", top: "55%", w: "70%", h: "75%", rotate: 18 },
	{ left: "45%", top: "50%", w: "75%", h: "70%", rotate: -14 },
	{ left: "25%", top: "20%", w: "55%", h: "60%", rotate: 6 },
];

function ModeCard({
	mode,
	label,
	icon,
	hint,
	active,
	onSelect,
}: {
	mode: AppearanceThemeMode;
	label: string;
	icon: string;
	hint: string;
	active: boolean;
	onSelect: (value: AppearanceThemeMode, event: MouseEvent<HTMLButtonElement>) => void;
}): ReactNode {
	return (
		<button
			type="button"
			onClick={(event) => onSelect(mode, event)}
			className={cn(
				"group relative flex flex-col items-start gap-2 rounded-xl border bg-card px-4 py-3 text-left transition-colors",
				active
					? "border-primary/70 ring-1 ring-inset ring-primary/30"
					: "border-border hover:border-primary/40 hover:bg-accent/40",
			)}
		>
			<div className="flex w-full items-center justify-between">
				<span className={cn(icon, "h-5 w-5", active ? "text-primary" : "text-muted-foreground")} />
				{active && <span className="icon-[mdi--check-circle] h-4 w-4 text-primary" />}
			</div>
			<div className="text-[13px] font-medium text-foreground">{label}</div>
			<div className="text-[11px] text-muted-foreground">{hint}</div>
		</button>
	);
}

function BlockCard({
	theme,
	active,
	onSelect,
}: {
	theme: AppearanceThemePreview;
	active: boolean;
	onSelect: (id: string, event: MouseEvent<HTMLButtonElement>) => void;
}): ReactNode {
	const palette = theme.dark;
	const colors = [palette.primary, palette.accent, palette.ring, palette.chart1, palette.chart2];

	return (
		<button type="button" onClick={(event) => onSelect(theme.id, event)} className="group flex flex-col items-stretch gap-2 text-left">
			<div
				className={cn(
					"relative aspect-[16/9] w-full overflow-hidden rounded-lg transition-all",
					active
						? "ring-1 ring-inset ring-primary/40 ring-offset-2 ring-offset-background"
						: "ring-1 ring-inset ring-border/60 group-hover:ring-primary/50",
				)}
				style={{ background: palette.background }}
			>
				<div className="absolute inset-0 flex items-center justify-center">
					<div className="relative aspect-square w-[180%]" style={{ filter: "blur(28px) saturate(115%)" }}>
						{BLOB_LAYOUT.map((b, i) => (
							<div
								key={`${theme.id}-${i}`}
								className="absolute"
								style={{
									left: b.left,
									top: b.top,
									width: b.w,
									height: b.h,
									transform: `rotate(${b.rotate}deg)`,
								}}
							>
								<div
									className="h-full w-full rounded-full"
									style={{
										background: colors[i],
										animationDuration: `${5 + i * 1.3}s`,
										animationDelay: `${i * -1.7}s`,
									}}
								/>
							</div>
						))}
					</div>
				</div>
				<div
					className="absolute left-1/2 top-1/2 w-[72%] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-md"
					style={{
						background: palette.card,
						border: `1px solid ${palette.border}`,
						boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
					}}
				>
					<div className="flex items-center gap-1 px-1.5 py-1" style={{ borderBottom: `1px solid ${palette.border}` }}>
						<span className="h-1 w-1 rounded-full" style={{ background: palette.destructive }} />
						<span className="h-1 w-1 rounded-full" style={{ background: palette.chart1 }} />
						<span className="h-1 w-1 rounded-full" style={{ background: palette.primary }} />
					</div>
					<div className="space-y-[5px] px-2 py-2.5">
						<div className="h-[3px] w-[80%] rounded-full" style={{ background: palette.foreground, opacity: 0.75 }} />
						<div className="h-[3px] w-[60%] rounded-full" style={{ background: palette.mutedForeground }} />
						<div className="h-[3px] w-[70%] rounded-full" style={{ background: palette.mutedForeground, opacity: 0.7 }} />
						<div className="h-[3px] w-[45%] rounded-full" style={{ background: palette.mutedForeground, opacity: 0.7 }} />
						<div className="flex items-center gap-1 pt-1.5">
							<span className="h-2.5 w-6 rounded-sm" style={{ background: palette.primary }} />
							<span className="h-2.5 w-4 rounded-sm" style={{ background: palette.accent }} />
						</div>
					</div>
				</div>
				{active && (
					<span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-background/85 shadow-sm backdrop-blur-sm">
						<span className="icon-[mdi--check] h-3.5 w-3.5 text-primary" />
					</span>
				)}
			</div>
			<span className={cn("text-[12px] transition-colors", active ? "font-medium text-foreground" : "text-muted-foreground")}>
				{theme.label}
			</span>
		</button>
	);
}

function CursorCard({
	value,
	label,
	hint,
	icon,
	preview,
	active,
	onSelect,
}: {
	value: string;
	label: string;
	hint: string;
	icon?: string;
	preview?: string;
	active: boolean;
	onSelect: (value: string) => void;
}): ReactNode {
	return (
		<button
			type="button"
			onClick={() => onSelect(value)}
			className={cn(
				"group relative flex flex-col items-start gap-2 rounded-xl border bg-card px-4 py-3 text-left transition-colors",
				active
					? "border-primary/70 ring-1 ring-inset ring-primary/30"
					: "border-border hover:border-primary/40 hover:bg-accent/40",
			)}
		>
			<div className="flex w-full items-center justify-between">
				<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/80">
					{preview ? (
						<img src={preview} alt="" className="h-7 w-7 object-contain" draggable={false} />
					) : (
						<span className={cn(icon, "h-6 w-6", active ? "text-primary" : "text-muted-foreground")} />
					)}
				</div>
				{active && <span className="icon-[mdi--check-circle] h-4 w-4 text-primary" />}
			</div>
			<div className="text-[13px] font-medium text-foreground">{label}</div>
			<div className="text-[11px] text-muted-foreground">{hint}</div>
		</button>
	);
}

export function AppearanceActionPickerView({
	mode,
	themeId,
	cursorStyle,
	themes,
	modes,
	cursors,
	labels,
	onModeChange,
	onThemeChange,
	onCursorStyleChange,
}: AppearanceActionPickerViewProps): JSX.Element {
	return (
		<div className="space-y-5">
			<fieldset>
				<legend className="mb-2.5 text-[13px] font-medium text-foreground">{labels.modeSection}</legend>
				<div className="grid grid-cols-3 gap-2.5">
					{modes.map((m) => (
						<ModeCard
							key={m.value}
							mode={m.value}
							label={m.label}
							icon={m.icon}
							hint={m.hint}
							active={mode === m.value}
							onSelect={(value) => onModeChange(value)}
						/>
					))}
				</div>
			</fieldset>
			<fieldset>
				<legend className="mb-2.5 text-[13px] font-medium text-foreground">{labels.themeSection}</legend>
				<div className="grid grid-cols-2 gap-x-3 gap-y-3">
					{themes.map((t) => (
						<BlockCard key={t.id} theme={t} active={themeId === t.id} onSelect={(id) => onThemeChange(id)} />
					))}
				</div>
			</fieldset>
			<fieldset>
				<legend className="mb-2.5 text-[13px] font-medium text-foreground">{labels.cursorSection}</legend>
				<div className="grid grid-cols-2 gap-2.5">
					{cursors.map((c) => (
						<CursorCard
							key={c.value}
							value={c.value}
							label={c.label}
							hint={c.hint}
							icon={c.icon}
							preview={c.preview}
							active={cursorStyle === c.value}
							onSelect={onCursorStyleChange}
						/>
					))}
				</div>
			</fieldset>
		</div>
	);
}
