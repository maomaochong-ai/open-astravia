import { cn } from "@shared/lib/utils";
import type { CursorStyle } from "@shared/theme/cursor";
import type { ThemeDef } from "@shared/theme/tokens";
import type { MouseEvent } from "react";
import { SettingsAiAssist } from "../ai-assist";
import appearanceMascot from "../assets/appearance-mascot.webp";
import themeLock from "../assets/theme-lock.webp";
import { SETTINGS_SECTION } from "../registry";
import { MotionSelect, SettingHeading } from "@vetta/theme-ui/settings";
import type { SidebarStyle } from "@shared/theme/sidebar-style";
import type {
	AppearanceCursorOption,
	AppearanceLanguageOption,
	AppearanceModeOption,
	AppearanceSettingsModel,
	AppearanceSidebarStyleOption,
	AppearanceUiThemeOption,
} from "./useAppearanceSettingsModel";

type ThemeMode = AppearanceModeOption["value"];

function languageOptionLabel(option: AppearanceLanguageOption): JSX.Element {
	return (
		<span className="flex min-w-0 items-center gap-1.5">
			<span
				className={cn(
					option.value === "system" ? "icon-[mdi--monitor]" : "icon-[mdi--translate]",
					"h-4 w-4 shrink-0 text-muted-foreground",
				)}
			/>
			<span className="min-w-0 truncate">
				<span className="font-medium text-foreground">{option.native}</span>
				<span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{option.alt}</span>
			</span>
		</span>
	);
}

function LanguageSelect({
	language,
	languages,
	onSelect,
}: {
	language: string;
	languages: AppearanceLanguageOption[];
	onSelect: (lang: AppearanceLanguageOption["value"]) => void;
}): JSX.Element {
	return (
		<MotionSelect
			value={language}
			onValueChange={(next) => onSelect(next as AppearanceLanguageOption["value"])}
			triggerClassName="w-[260px]"
			options={languages.map((option) => ({
				value: option.value,
				label: languageOptionLabel(option),
			}))}
		/>
	);
}

function SelectionCheckBadge(): JSX.Element {
	return (
		<span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-background/85 shadow-sm backdrop-blur-sm">
			<span className="icon-[mdi--check] h-3.5 w-3.5 text-primary" />
		</span>
	);
}

/**
 * 选中态只改 border 颜色（1px），不要叠 ring——border + ring-inset 会叠成约 2px 双线。
 * 与 ImChannelCard 等设置页一致：idle/active 都走同一根 border。
 */
const SELECTION_ACTIVE = "border-primary/50 bg-primary/10";
const SELECTION_IDLE = "border-border/60 hover:border-primary/40 hover:bg-accent/40";

function ModeCard({
	mode,
	label,
	icon,
	hint,
	active,
	onSelect,
}: {
	mode: ThemeMode;
	label: string;
	icon: string;
	hint: string;
	active: boolean;
	onSelect: (value: ThemeMode, event: MouseEvent<HTMLButtonElement>) => void;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={(event) => onSelect(mode, event)}
			className={cn(
				"group relative flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2 text-left transition-all",
				active ? SELECTION_ACTIVE : SELECTION_IDLE,
			)}
		>
			<span className={cn(icon, "h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
			<div className="min-w-0 flex-1 pr-5">
				<div className="text-[12px] font-medium text-foreground">{label}</div>
				<div className="truncate text-[11px] text-muted-foreground">{hint}</div>
			</div>
			{active && <SelectionCheckBadge />}
		</button>
	);
}

const BLOB_LAYOUT: { left: string; top: string; w: string; h: string; rotate: number }[] = [
	{ left: "-15%", top: "-20%", w: "75%", h: "75%", rotate: -8 },
	{ left: "55%", top: "-15%", w: "70%", h: "70%", rotate: 12 },
	{ left: "-10%", top: "55%", w: "70%", h: "75%", rotate: 18 },
	{ left: "45%", top: "50%", w: "75%", h: "70%", rotate: -14 },
	{ left: "25%", top: "20%", w: "55%", h: "60%", rotate: 6 },
];

function ThemeCard({
	theme,
	active,
	onSelect,
}: {
	theme: ThemeDef;
	active: boolean;
	onSelect: (id: string, event: MouseEvent<HTMLButtonElement>) => void;
}): JSX.Element {
	const palette = theme.dark;
	const colors = [palette.primary, palette.accent, palette.ring, palette.chart1, palette.chart2];
	return (
		<button
			type="button"
			onClick={(event) => onSelect(theme.id, event)}
			className="group flex flex-col items-stretch gap-2 text-left"
		>
			<div
				className={cn(
					// 主题色预览本身带底色，选中只改 1px border 色，不叠 ring / bg
					"relative aspect-[16/9] w-full overflow-hidden rounded-lg border transition-all",
					active ? "border-primary/50" : "border-border/60 group-hover:border-primary/40",
				)}
				style={{ background: palette.background }}
			>
				<div className="absolute inset-0 flex items-center justify-center">
					<div className={cn("relative aspect-square w-[180%]", active && "theme-blob-spin")} style={{ filter: "blur(28px) saturate(115%)" }}>
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
									className={cn("h-full w-full rounded-full", active && "theme-blob-ripple")}
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
				{active && <SelectionCheckBadge />}
			</div>
			<span className={cn("text-[12px] transition-colors", active ? "font-medium text-foreground" : "text-muted-foreground")}>
				{theme.label}
			</span>
		</button>
	);
}

function UiThemeCard({
	active,
	disabled,
	hint,
	label,
	onSelect,
	preview,
	unavailable,
}: AppearanceUiThemeOption & {
	onSelect: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onSelect}
			className={cn(
				"group relative rounded-xl border bg-card text-left transition-all",
				active ? SELECTION_ACTIVE : SELECTION_IDLE,
				disabled && "cursor-not-allowed",
			)}
		>
			<div className="overflow-hidden rounded-xl">
				<div className="relative aspect-[16/9] overflow-hidden border-b border-border/50">
					<img src={preview} alt="" className={cn("h-full w-full object-cover", disabled && "opacity-50")} />
					{unavailable ? (
						<span className="absolute inset-0 flex items-center justify-center">
							<img src={themeLock} alt="" className="h-14 w-auto object-contain" />
						</span>
					) : null}
				</div>
				<div className="px-3.5 pb-3 pt-3">
					<div className="text-[13px] font-medium text-card-foreground">{label}</div>
					<div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>
				</div>
			</div>
			{active && !unavailable && <SelectionCheckBadge />}
		</button>
	);
}

/** 迷你窗口示意图：经典=侧栏贴边仅右侧分隔线；悬浮=侧栏四周留白带圆角边框。 */
function SidebarStylePreview({ style }: { style: SidebarStyle }): JSX.Element {
	const classic = style === "classic";
	return (
		<div
			className={cn(
				"flex h-9 w-14 overflow-hidden rounded-md border border-border bg-background",
				!classic && "gap-1 p-1",
			)}
		>
			<div
				className={cn(
					"w-[34%] shrink-0 bg-muted",
					classic ? "border-r border-border" : "rounded-[3px] border border-border",
				)}
			/>
			<div className="flex-1" />
		</div>
	);
}

function SidebarStyleCard({
	active,
	hint,
	id,
	label,
	onSelect,
}: AppearanceSidebarStyleOption & {
	onSelect: (style: SidebarStyle) => void;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={() => onSelect(id)}
			className={cn(
				"group relative flex min-h-[72px] items-center gap-3 rounded-xl border bg-card px-3.5 py-3 text-left transition-all",
				active ? SELECTION_ACTIVE : SELECTION_IDLE,
			)}
		>
			<SidebarStylePreview style={id} />
			<div className="min-w-0 flex-1 pr-5">
				<div className="text-[13px] font-medium text-foreground">{label}</div>
				<div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{hint}</div>
			</div>
			{active && <SelectionCheckBadge />}
		</button>
	);
}

function CursorStyleCard({
	active,
	hint,
	icon,
	id,
	label,
	onSelect,
	preview,
}: AppearanceCursorOption & {
	onSelect: (style: CursorStyle) => void;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={() => onSelect(id)}
			className={cn(
				// 两列宽卡：略增高预览区，与上方主题卡节奏一致
				"group relative flex min-h-[72px] items-center gap-3 rounded-xl border bg-card px-3.5 py-3 text-left transition-all",
				active ? SELECTION_ACTIVE : SELECTION_IDLE,
			)}
		>
			<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted/80">
				{preview ? (
					<img src={preview} alt="" className="h-7 w-7 object-contain" draggable={false} />
				) : (
					<span className={cn(icon, "h-5 w-5", active ? "text-primary" : "text-muted-foreground")} />
				)}
			</div>
			<div className="min-w-0 flex-1 pr-5">
				<div className="text-[13px] font-medium text-foreground">{label}</div>
				<div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{hint}</div>
			</div>
			{active && <SelectionCheckBadge />}
		</button>
	);
}

export function AppearanceSettingsView({ model }: { model: AppearanceSettingsModel }): JSX.Element {
	return (
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-4">
			<div className="mb-4 flex min-w-0 flex-wrap items-center gap-3">
				<h1 className="text-[20px] font-bold text-foreground">{model.labels.title}</h1>
				<SettingsAiAssist tabId="appearance" />
			</div>

			{/* 语言区 + 右侧外观吉祥物 */}
			<div className="mb-6 flex items-center gap-4 pr-10">
				<div className="min-w-0 flex-1">
					<SettingHeading title={model.labels.sections.language} section={SETTINGS_SECTION["appearance-language"]} className="mb-1" />
					<p className="mb-3 text-[12px] text-muted-foreground">{model.labels.languageHint}</p>
					<LanguageSelect language={model.language} languages={model.languages} onSelect={model.actions.changeLanguage} />
				</div>
				{!model.narrow && (
					<div className="flex h-[100px] w-[120px] shrink-0 items-center justify-center">
						<img
							aria-hidden="true"
							alt=""
							className="pointer-events-none h-[100px] w-auto select-none object-contain"
							draggable={false}
							src={appearanceMascot}
						/>
					</div>
				)}
			</div>

			<div className="mb-6">
				<SettingHeading title={model.labels.sections.mode} section={SETTINGS_SECTION["appearance-mode"]} className="mb-3" />
				<div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
					{model.modeOptions.map((mode) => (
						<ModeCard
							key={mode.value}
							mode={mode.value}
							label={mode.label}
							icon={mode.icon}
							hint={mode.hint}
							active={model.mode === mode.value}
							onSelect={(value, event) => model.actions.changeMode(value, { x: event.clientX, y: event.clientY })}
						/>
					))}
				</div>
			</div>

			<div className="mb-6">
				<SettingHeading title={model.labels.sections.sidebar} section={SETTINGS_SECTION["appearance-sidebar"]} className="mb-3" />
				<div className="grid grid-cols-2 gap-3">
					{model.sidebarStyleOptions.map((option) => (
						<SidebarStyleCard key={option.id} {...option} onSelect={model.actions.setSidebarStyle} />
					))}
				</div>
			</div>

			{model.showUiTheme && (
				<div className="mb-6">
					<SettingHeading title={model.labels.sections.uiTheme} section={SETTINGS_SECTION["appearance-ui-theme"]} className="mb-3" />
					<div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
						{model.uiThemes.map((theme) => (
							<UiThemeCard key={theme.id} {...theme} onSelect={() => model.actions.selectUiTheme(theme.id)} />
						))}
					</div>
				</div>
			)}

			{/* 鼠标指针：两列卡片，置于主题色上方 */}
			<div className="mb-6">
				<SettingHeading title={model.labels.sections.cursor} section={SETTINGS_SECTION["appearance-cursor"]} className="mb-3" />
				<div className="grid grid-cols-2 gap-3">
					{model.cursorOptions.map((option) => (
						<CursorStyleCard
							key={option.id}
							{...option}
							onSelect={model.actions.setCursorStyle}
						/>
					))}
				</div>
			</div>

			{model.activeUiThemeId === "default" && (
				<div className="mb-6">
					<SettingHeading title={model.labels.sections.theme} section={SETTINGS_SECTION["appearance-theme"]} className="mb-3" />
					<div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
						{model.themes.map((theme) => (
							<ThemeCard
								key={theme.id}
								theme={theme}
								active={model.themeName === theme.id}
								onSelect={(id, event) => model.actions.changeThemeName(id, { x: event.clientX, y: event.clientY })}
							/>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
