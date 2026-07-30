import { STOAT_CURSOR_PREVIEW_URL, type CursorStyle } from "@shared/theme/cursor";
import { THEMES } from "@shared/theme/themes";
import {
	AppearanceActionPickerView,
	type AppearanceCursorOption,
	type AppearanceModeOption,
	type AppearanceThemeMode,
	type AppearanceThemePreview,
} from "@vetta/theme-ui/action-approval";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

const COLOR_THEME_LABEL_KEYS = {
	mono: "colorThemes.mono",
	default: "colorThemes.default",
	sand: "colorThemes.sand",
} as const;

export function AppearanceActionPicker({
	mode,
	themeId,
	cursorStyle,
	onModeChange,
	onThemeChange,
	onCursorStyleChange,
}: {
	mode: AppearanceThemeMode;
	themeId: string;
	cursorStyle: CursorStyle;
	onModeChange: (mode: AppearanceThemeMode) => void;
	onThemeChange: (themeId: string) => void;
	onCursorStyleChange: (style: CursorStyle) => void;
}): JSX.Element {
	const { t } = useTranslation("settings");

	const modes = useMemo<AppearanceModeOption[]>(
		() => [
			{ value: "light", label: t("themeLight"), icon: "icon-[mdi--white-balance-sunny]", hint: t("appearanceLightHint") },
			{ value: "dark", label: t("themeDark"), icon: "icon-[mdi--moon-waning-crescent]", hint: t("appearanceDarkHint") },
			{ value: "auto", label: t("themeSystem"), icon: "icon-[mdi--theme-light-dark]", hint: t("appearanceAutoHint") },
		],
		[t],
	);

	const cursors = useMemo<AppearanceCursorOption[]>(
		() => [
			{
				value: "default",
				label: t("cursorDefaultTitle"),
				hint: t("cursorDefaultHint"),
				icon: "icon-[mdi--cursor-default-outline]",
			},
			{
				value: "stoat",
				label: t("cursorStoatTitle"),
				hint: t("cursorStoatHint"),
				preview: STOAT_CURSOR_PREVIEW_URL,
			},
		],
		[t],
	);

	const themes = useMemo<AppearanceThemePreview[]>(
		() =>
			THEMES.map((theme) => {
				const labelKey = COLOR_THEME_LABEL_KEYS[theme.id as keyof typeof COLOR_THEME_LABEL_KEYS];
				return {
					id: theme.id,
					label: labelKey ? t(labelKey) : theme.label,
					dark: {
						primary: theme.dark.primary,
						accent: theme.dark.accent,
						ring: theme.dark.ring,
						chart1: theme.dark.chart1,
						chart2: theme.dark.chart2,
						background: theme.dark.background,
						card: theme.dark.card,
						border: theme.dark.border,
						destructive: theme.dark.destructive,
						foreground: theme.dark.foreground,
						mutedForeground: theme.dark.mutedForeground,
					},
				};
			}),
		[t],
	);

	const labels = useMemo(
		() => ({
			modeSection: t("section_appearance-mode"),
			themeSection: t("section_appearance-theme"),
			cursorSection: t("section_appearance-cursor"),
		}),
		[t],
	);

	return (
		<AppearanceActionPickerView
			mode={mode}
			themeId={themeId}
			cursorStyle={cursorStyle}
			themes={themes}
			modes={modes}
			cursors={cursors}
			labels={labels}
			onModeChange={onModeChange}
			onThemeChange={onThemeChange}
			onCursorStyleChange={(style) => onCursorStyleChange(style as CursorStyle)}
		/>
	);
}
