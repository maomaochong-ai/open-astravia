import { useLanguage } from "@shared/hooks/useLanguage";
import { useTheme } from "@shared/hooks/useTheme";
import { cn } from "@shared/lib/utils";
import type { ThemeMode } from "@shared/store/atoms";
import { THEMES } from "@shared/theme/themes";
import type { ThemeDef } from "@shared/theme/tokens";
import type { LanguagePreference } from "@/shared/i18n/config";
import { type MouseEvent, useMemo } from "react";
import { useTranslation } from "react-i18next";

/** 固定语言自称；system 项 label 由 i18n 注入。 */
const FIXED_LANGUAGES: ReadonlyArray<{
	value: Exclude<LanguagePreference, "system">;
	native: string;
	alt: string;
}> = [
	{ value: "zh", native: "中文", alt: "Chinese" },
	{ value: "en", native: "English", alt: "英文" },
];

const MODE_OPTIONS = [
	{
		value: "light" as const,
		labelKey: "themeLight",
		icon: "icon-[solar--sun-linear]",
		hintKey: "appearanceLightHint",
	},
	{
		value: "dark" as const,
		labelKey: "themeDark",
		icon: "icon-[solar--moon-linear]",
		hintKey: "appearanceDarkHint",
	},
	{
		value: "auto" as const,
		labelKey: "themeSystem",
		icon: "icon-[solar--pallete-2-linear]",
		hintKey: "appearanceAutoHint",
	},
] as const;

const COLOR_THEME_LABEL_KEYS = {
	mono: "colorThemes.mono",
	default: "colorThemes.default",
	sand: "colorThemes.sand",
} as const;

function CompactThemeCard({
	theme,
	label,
	active,
	onSelect,
}: {
	theme: ThemeDef;
	label: string;
	active: boolean;
	onSelect: (id: string, event: MouseEvent<HTMLButtonElement>) => void;
}): JSX.Element {
	const palette = theme.dark;
	const swatches = [palette.primary, palette.accent, palette.ring, palette.chart1];
	return (
		<button
			type="button"
			onClick={(event) => onSelect(theme.id, event)}
			className={cn(
				"group flex flex-col gap-1.5 text-left transition-colors",
				active ? "opacity-100" : "opacity-90 hover:opacity-100",
			)}
		>
			<div
				className={cn(
					// 全宽 2×3：固定预览高度，避免 aspect 随列宽变高
					"relative h-[4.75rem] w-full overflow-hidden rounded-lg transition-colors",
					active
						? "ring-1 ring-inset ring-primary/40"
						: "ring-1 ring-border/50 group-hover:ring-primary/40",
				)}
				style={{ background: palette.background }}
			>
				<div className="absolute inset-0 flex items-stretch justify-between gap-1 p-2">
					<div
						className="h-full w-[42%] rounded-md"
						style={{
							background: palette.card,
							border: `1px solid ${palette.border}`,
						}}
					/>
					<div className="flex flex-1 flex-col justify-start gap-1 pt-0.5">
						{swatches.map((color, i) => (
							<span
								key={`${theme.id}-swatch-${i}`}
								className="h-1.5 rounded-full"
								style={{
									background: color,
									width: `${70 - i * 12}%`,
									opacity: 0.9 - i * 0.1,
								}}
							/>
						))}
					</div>
				</div>
				{active && (
					<span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-background/90">
						<span className="icon-[solar--check-circle-linear] h-3.5 w-3.5 text-primary" />
					</span>
				)}
			</div>
			<span
				className={cn(
					"truncate text-[11px]",
					active ? "font-medium text-foreground" : "text-muted-foreground",
				)}
			>
				{label}
			</span>
		</button>
	);
}

export function LanguageAppearanceStep(): JSX.Element {
	const { t } = useTranslation(["common", "settings"]);
	const { languagePreference, setLanguage } = useLanguage();
	const { mode, themeName, setMode, setThemeName } = useTheme();

	const languages = useMemo(
		() => [
			{
				value: "system" as const,
				native: t("settings:languageSystem"),
				alt: t("settings:languageSystemAlt"),
				icon: "icon-[solar--monitor-linear]",
			},
			...FIXED_LANGUAGES.map((lang) => ({
				...lang,
				icon: "icon-[solar--global-linear]",
			})),
		],
		[t],
	);

	const modeOptions = useMemo(
		() =>
			MODE_OPTIONS.map((option) => ({
				value: option.value,
				label: t(`settings:${option.labelKey}`),
				icon: option.icon,
				hint: t(`settings:${option.hintKey}`),
			})),
		[t],
	);

	const themes = useMemo(
		() =>
			THEMES.map((theme) => {
				const labelKey = COLOR_THEME_LABEL_KEYS[theme.id as keyof typeof COLOR_THEME_LABEL_KEYS];
				return {
					...theme,
					label: labelKey ? t(`settings:${labelKey}`) : theme.label,
				};
			}),
		[t],
	);

	return (
		<div className="flex w-full flex-col gap-5">
			<div className="text-center">
				<div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-border/50 bg-card/40">
					<span className="icon-[solar--pallete-2-linear] h-6 w-6 text-primary" />
				</div>
				<h2 className="text-[15px] font-semibold text-foreground">
					{t("setupWizard.languageAppearance.title")}
				</h2>
				<p className="mt-1 text-[12px] text-muted-foreground">
					{t("setupWizard.languageAppearance.subtitle")}
				</p>
			</div>

			<section>
				<h3 className="mb-2 text-[12px] font-medium text-muted-foreground">
					{t("setupWizard.languageAppearance.language")}
				</h3>
				<div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2.5">
					{languages.map((lang) => {
						const active = languagePreference === lang.value;
						return (
							<button
								key={lang.value}
								type="button"
								onClick={() => void setLanguage(lang.value)}
								className={cn(
									"relative flex items-center gap-2 rounded-xl border px-3.5 py-3 text-left transition-colors",
									active
										? "border-primary/40 bg-primary/10 ring-1 ring-inset ring-primary/30"
										: "border-border/50 bg-card/40 hover:border-primary/40 hover:bg-card/60",
								)}
							>
								<span
									className={cn(
										lang.icon,
										"h-4 w-4 shrink-0",
										active ? "text-primary" : "text-muted-foreground",
									)}
								/>
								<span className="min-w-0 flex-1">
									<span className="block text-[13px] font-medium text-foreground">{lang.native}</span>
									<span className="block text-[11px] text-muted-foreground">{lang.alt}</span>
								</span>
								{active && (
									<span className="icon-[solar--check-circle-linear] h-4 w-4 shrink-0 text-primary" />
								)}
							</button>
						);
					})}
				</div>
			</section>

			<section>
				<h3 className="mb-2 text-[12px] font-medium text-muted-foreground">
					{t("setupWizard.languageAppearance.appearance")}
				</h3>
				<div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2.5">
					{modeOptions.map((option) => {
						const active = mode === option.value;
						return (
							<button
								key={option.value}
								type="button"
								onClick={() => {
									void setMode(option.value as ThemeMode, {
										x: window.innerWidth / 2,
										y: window.innerHeight / 2,
									});
								}}
								className={cn(
									"relative flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
									active
										? "border-primary/40 bg-primary/10 ring-1 ring-inset ring-primary/30"
										: "border-border/50 bg-card/40 hover:border-primary/40 hover:bg-card/60",
								)}
							>
								<span
									className={cn(
										option.icon,
										"h-4 w-4 shrink-0",
										active ? "text-primary" : "text-muted-foreground",
									)}
								/>
								<span className="min-w-0 flex-1">
									<span className="block text-[12px] font-medium text-foreground">{option.label}</span>
									<span className="block truncate text-[10px] text-muted-foreground">{option.hint}</span>
								</span>
								{active && (
									<span className="icon-[solar--check-circle-linear] h-4 w-4 shrink-0 text-primary" />
								)}
							</button>
						);
					})}
				</div>
			</section>

			<section>
				<h3 className="mb-2 text-[12px] font-medium text-muted-foreground">
					{t("setupWizard.languageAppearance.theme")}
				</h3>
				{/* 三列铺满宽度；预览高度固定，避免 aspect 随列宽变高 */}
				<div className="grid w-full grid-cols-3 gap-2.5">
					{themes.map((theme) => (
						<CompactThemeCard
							key={theme.id}
							theme={theme}
							label={theme.label}
							active={themeName === theme.id}
							onSelect={(id, event) => {
								setThemeName(id, { x: event.clientX, y: event.clientY });
							}}
						/>
					))}
				</div>
			</section>
		</div>
	);
}
