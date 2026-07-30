import { useCursorStyle } from "@shared/hooks/useCustomCursor";
import { useLanguage } from "@shared/hooks/useLanguage";
import { useNarrowScreen } from "@shared/hooks/useNarrowScreen";
import { useSidebarStyle } from "@shared/hooks/useSidebarStyle";
import { useTheme } from "@shared/hooks/useTheme";
import type { ThemeMode } from "@shared/store/atoms";
import { type CursorStyle, STOAT_CURSOR_PREVIEW_URL } from "@shared/theme/cursor";
import { useThemeRuntime } from "@shared/theme/runtime";
import type { SidebarStyle } from "@shared/theme/sidebar-style";
import { THEMES } from "@shared/theme/themes";
import type { ThemeDef } from "@shared/theme/tokens";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { isAppearanceUiThemeEnabled } from "@/shared/feature-flags";
import type { LanguagePreference } from "@/shared/i18n/config";
import defaultThemePreview from "../assets/default.webp";
import xianxiaThemePreview from "../assets/xianxia.webp";
import { SETTINGS_SECTION } from "../registry";
import { recordSettingsUsage } from "./recordSettingsUsage";

interface AppearancePoint {
	x: number;
	y: number;
}

export interface AppearanceModeOption {
	hint: string;
	icon: string;
	label: string;
	value: ThemeMode;
}

export interface AppearanceLanguageOption {
	alt: string;
	native: string;
	value: LanguagePreference;
}

export interface AppearanceUiThemeOption {
	active: boolean;
	disabled: boolean;
	hint: string;
	id: string;
	label: string;
	preview: string;
	unavailable: boolean;
}

export interface AppearanceCursorOption {
	active: boolean;
	hint: string;
	id: CursorStyle;
	label: string;
	/** 预览图 URL；缺省时用 icon */
	preview?: string;
	icon?: string;
}

export interface AppearanceSidebarStyleOption {
	active: boolean;
	hint: string;
	id: SidebarStyle;
	label: string;
}

export interface AppearanceSettingsModel {
	actions: {
		changeLanguage: (language: LanguagePreference) => void;
		changeMode: (mode: ThemeMode, point: AppearancePoint) => void;
		changeThemeName: (id: string, point: AppearancePoint) => void;
		selectUiTheme: (id: string) => void;
		setCursorStyle: (style: CursorStyle) => void;
		setSidebarStyle: (style: SidebarStyle) => void;
	};
	activeUiThemeId: string;
	cursorOptions: AppearanceCursorOption[];
	cursorStyle: CursorStyle;
	labels: {
		languageHint: string;
		sections: {
			cursor: string;
			language: string;
			mode: string;
			sidebar: string;
			theme: string;
			uiTheme: string;
		};
		title: string;
	};
	/** 用户语言偏好（含 system），用于选择器高亮。 */
	language: LanguagePreference;
	languages: AppearanceLanguageOption[];
	mode: ThemeMode;
	modeOptions: AppearanceModeOption[];
	narrow: boolean;
	/** 是否展示「界面主题」区段（`VETTA_SHOW_UI_THEME=true`） */
	showUiTheme: boolean;
	sidebarStyle: SidebarStyle;
	sidebarStyleOptions: AppearanceSidebarStyleOption[];
	themeName: string;
	themes: ThemeDef[];
	uiThemes: AppearanceUiThemeOption[];
}

const MODE_OPTIONS = [
	{
		value: "light",
		labelKey: "themeLight",
		icon: "icon-[mdi--white-balance-sunny]",
		hintKey: "appearanceLightHint",
	},
	{
		value: "dark",
		labelKey: "themeDark",
		icon: "icon-[mdi--moon-waning-crescent]",
		hintKey: "appearanceDarkHint",
	},
	{
		value: "auto",
		labelKey: "themeSystem",
		icon: "icon-[mdi--theme-light-dark]",
		hintKey: "appearanceAutoHint",
	},
] as const satisfies ReadonlyArray<{
	hintKey: "appearanceAutoHint" | "appearanceDarkHint" | "appearanceLightHint";
	icon: string;
	labelKey: "themeDark" | "themeLight" | "themeSystem";
	value: ThemeMode;
}>;

/** 固定语言名（语种自称，非 UI chrome 文案）；system 项 label 由 i18n 注入。 */
const FIXED_LANGUAGE_OPTIONS: ReadonlyArray<{
	value: Exclude<LanguagePreference, "system">;
	native: string;
	alt: string;
}> = [
	{ value: "zh", native: "中文", alt: "Chinese" },
	{ value: "en", native: "English", alt: "英文" },
];

const UI_THEME_OPTIONS = [
	{
		id: "default",
		labelKey: "uiThemeDefault",
		hintKey: "uiThemeDefaultHint",
		preview: defaultThemePreview,
	},
	{
		id: "xianxia",
		labelKey: "uiThemeXianxia",
		hintKey: "uiThemeXianxiaHint",
		preview: xianxiaThemePreview,
	},
] as const;

const CURSOR_OPTIONS = [
	{
		id: "default" as const,
		labelKey: "cursorDefaultTitle",
		hintKey: "cursorDefaultHint",
		icon: "icon-[mdi--cursor-default-outline]",
	},
	{
		id: "stoat" as const,
		labelKey: "cursorStoatTitle",
		hintKey: "cursorStoatHint",
		preview: STOAT_CURSOR_PREVIEW_URL,
	},
] as const;

const SIDEBAR_STYLE_OPTIONS = [
	{
		id: "classic" as const,
		labelKey: "sidebarStyleClassicTitle",
		hintKey: "sidebarStyleClassicHint",
	},
	{
		id: "floating" as const,
		labelKey: "sidebarStyleFloatingTitle",
		hintKey: "sidebarStyleFloatingHint",
	},
] as const;

const COLOR_THEME_LABEL_KEYS = {
	mono: "colorThemes.mono",
	default: "colorThemes.default",
	emerald: "colorThemes.emerald",
	sand: "colorThemes.sand",
	slate: "colorThemes.slate",
	voltage: "colorThemes.voltage",
} as const;

export function useAppearanceSettingsModel(): AppearanceSettingsModel {
	const { mode, themeName, setMode, setThemeName } = useTheme();
	const { activeThemeId, availableThemes, selectTheme, status: themeRuntimeStatus } = useThemeRuntime();
	const { languagePreference, setLanguage } = useLanguage();
	const { style: cursorStyle, setStyle: setCursorStyle } = useCursorStyle();
	const { style: sidebarStyle, setStyle: setSidebarStyle } = useSidebarStyle();
	const { t } = useTranslation("settings");
	const narrow = useNarrowScreen();

	const languages = useMemo<AppearanceLanguageOption[]>(
		() => [
			{
				value: "system",
				native: t("languageSystem"),
				alt: t("languageSystemAlt"),
			},
			...FIXED_LANGUAGE_OPTIONS,
		],
		[t],
	);

	const modeOptions = useMemo<AppearanceModeOption[]>(
		() =>
			MODE_OPTIONS.map((option) => ({
				value: option.value,
				label: t(option.labelKey),
				icon: option.icon,
				hint: t(option.hintKey),
			})),
		[t],
	);

	const uiThemes = useMemo<AppearanceUiThemeOption[]>(
		() =>
			UI_THEME_OPTIONS.map((theme) => {
				const unavailable =
					theme.id !== "default" &&
					themeRuntimeStatus !== "loading" &&
					!availableThemes.some((availableTheme) => availableTheme.id === theme.id);
				return {
					id: theme.id,
					active: activeThemeId === theme.id,
					disabled: themeRuntimeStatus === "loading" || unavailable,
					label: t(theme.labelKey),
					hint: unavailable ? t("uiThemeUnavailable") : t(theme.hintKey),
					preview: theme.preview,
					unavailable,
				};
			}),
		[activeThemeId, availableThemes, t, themeRuntimeStatus],
	);

	const cursorOptions = useMemo<AppearanceCursorOption[]>(
		() =>
			CURSOR_OPTIONS.map((option) => ({
				id: option.id,
				active: cursorStyle === option.id,
				label: t(option.labelKey),
				hint: t(option.hintKey),
				preview: "preview" in option ? option.preview : undefined,
				icon: "icon" in option ? option.icon : undefined,
			})),
		[cursorStyle, t],
	);

	const sidebarStyleOptions = useMemo<AppearanceSidebarStyleOption[]>(
		() =>
			SIDEBAR_STYLE_OPTIONS.map((option) => ({
				id: option.id,
				active: sidebarStyle === option.id,
				label: t(option.labelKey),
				hint: t(option.hintKey),
			})),
		[sidebarStyle, t],
	);

	const themes = useMemo(
		() =>
			THEMES.map((theme) => {
				const labelKey = COLOR_THEME_LABEL_KEYS[theme.id as keyof typeof COLOR_THEME_LABEL_KEYS];
				return {
					...theme,
					label: labelKey ? t(labelKey) : theme.label,
				};
			}),
		[t],
	);

	const labels = useMemo(
		() => ({
			languageHint: t("languageHint"),
			sections: {
				cursor: t(SETTINGS_SECTION["appearance-cursor"].titleKey),
				language: t(SETTINGS_SECTION["appearance-language"].titleKey),
				mode: t(SETTINGS_SECTION["appearance-mode"].titleKey),
				sidebar: t(SETTINGS_SECTION["appearance-sidebar"].titleKey),
				theme: t(SETTINGS_SECTION["appearance-theme"].titleKey),
				uiTheme: t(SETTINGS_SECTION["appearance-ui-theme"].titleKey),
			},
			title: t("appearanceTitle"),
		}),
		[t],
	);

	return {
		actions: {
			changeLanguage: (nextLanguage) => {
				void setLanguage(nextLanguage);
				recordSettingsUsage({ tab: "appearance", action: "changed", target: "language", value: nextLanguage });
			},
			changeMode: (nextMode, point) => {
				void setMode(nextMode, point);
				recordSettingsUsage({ tab: "appearance", action: "changed", target: "mode", value: nextMode });
			},
			changeThemeName: (id, point) => {
				setThemeName(id, point);
				recordSettingsUsage({ tab: "appearance", action: "changed", target: "color-theme", value: id });
			},
			selectUiTheme: (id) => {
				void selectTheme(id);
				recordSettingsUsage({ tab: "appearance", action: "selected", target: "ui-theme", value: id });
			},
			setCursorStyle: (style) => {
				setCursorStyle(style);
				recordSettingsUsage({
					tab: "appearance",
					action: "changed",
					target: "cursor-style",
					value: style,
				});
			},
			setSidebarStyle: (style) => {
				setSidebarStyle(style);
				recordSettingsUsage({
					tab: "appearance",
					action: "changed",
					target: "sidebar-style",
					value: style,
				});
			},
		},
		activeUiThemeId: activeThemeId,
		cursorOptions,
		cursorStyle,
		labels,
		language: languagePreference,
		languages,
		mode,
		modeOptions,
		narrow,
		showUiTheme: isAppearanceUiThemeEnabled(),
		sidebarStyle,
		sidebarStyleOptions,
		themeName,
		themes,
		uiThemes,
	};
}
