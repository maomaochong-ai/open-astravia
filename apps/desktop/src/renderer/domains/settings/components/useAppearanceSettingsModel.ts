import { useAppIcon } from "@shared/hooks/useAppIcon";
import { useHeroOrnament } from "@shared/hooks/useHeroOrnament";
import { useLanguage } from "@shared/hooks/useLanguage";
import { useNarrowScreen } from "@shared/hooks/useNarrowScreen";
import { useNewSessionTexture } from "@shared/hooks/useNewSessionTexture";
import { useTheme } from "@shared/hooks/useTheme";
import { useUiFont } from "@shared/hooks/useUiFont";
import { useUiZoom } from "@shared/hooks/useUiZoom";
import type { ThemeMode } from "@shared/store/atoms";
import { COLOR_THEME_LABEL_KEYS } from "@shared/theme/color-theme-label-keys";
import { NEW_SESSION_TEXTURE_CATALOG, type NewSessionTextureId } from "@shared/theme/new-session-texture";
import { ORNAMENT_CATALOG, type OrnamentId } from "@shared/theme/ornament";
import { useThemeRuntime } from "@shared/theme/runtime";
import { THEMES } from "@shared/theme/themes";
import type { ThemeDef } from "@shared/theme/tokens";
import type { UiFontFamily } from "@shared/theme/ui-font";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { APP_ICON_IDS, type AppIconId } from "@/shared/app-icon";
import { isAppearanceUiThemeEnabled } from "@/shared/feature-flags";
import type { LanguagePreference } from "@/shared/i18n/config";
import { UI_ZOOM_DEFAULT, UI_ZOOM_STEPS, uiZoomStepIndex } from "@/shared/ui-zoom";
import appIconPreview_coding from "../assets/app-icons/coding.png";
import appIconPreview_cook from "../assets/app-icons/cook.png";
import appIconPreview_default from "../assets/app-icons/default.png";
import appIconPreview_design from "../assets/app-icons/design.png";
import appIconPreview_game from "../assets/app-icons/game.png";
import appIconPreview_read from "../assets/app-icons/read.png";
import appIconPreview_sleep from "../assets/app-icons/sleep.png";
import appIconPreview_sport from "../assets/app-icons/sport.png";
import appIconPreview_study from "../assets/app-icons/study.png";
import appIconPreview_travel from "../assets/app-icons/travel.png";
import appIconPreview_work from "../assets/app-icons/work.png";
import defaultThemePreview from "../assets/default.webp";
import xianxiaThemePreview from "../assets/xianxia.webp";

/** 设置页预览图：build 下同名 id 才是真正套用的资源，这里只要缩略图。 */
const APP_ICON_PREVIEWS: Record<AppIconId, string> = {
	default: appIconPreview_default,
	coding: appIconPreview_coding,
	design: appIconPreview_design,
	work: appIconPreview_work,
	study: appIconPreview_study,
	read: appIconPreview_read,
	game: appIconPreview_game,
	sport: appIconPreview_sport,
	cook: appIconPreview_cook,
	travel: appIconPreview_travel,
	sleep: appIconPreview_sleep,
};

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

export interface AppearanceOrnamentOption {
	active: boolean;
	hint: string;
	id: OrnamentId;
	label: string;
	/** 静态预览图；「无」没有预览，卡片改画空插槽。 */
	preview?: string;
}

export interface AppearanceTextureOption {
	active: boolean;
	hint: string;
	id: NewSessionTextureId;
	label: string;
}

export interface AppearanceAppIconOption {
	active: boolean;
	id: AppIconId;
	label: string;
	preview: string;
}

export interface AppearanceFontOption<T extends string = UiFontFamily> {
	active: boolean;
	hint: string;
	id: T;
	label: string;
}
export interface AppearanceSettingsModel {
	actions: {
		changeLanguage: (language: LanguagePreference) => void;
		changeMode: (mode: ThemeMode, point: AppearancePoint) => void;
		changeThemeName: (id: string, point: AppearancePoint) => void;
		selectUiTheme: (id: string) => void;
		setOrnament: (id: OrnamentId) => void;
		setTexture: (id: NewSessionTextureId) => void;
		/** 全局字体：界面、消息正文、代码与终端一起换。 */
		setFont: (family: UiFontFamily) => void;
		/** 应用图标：主进程立即换 Dock / 窗口图标并落盘。 */
		setAppIcon: (id: AppIconId) => void;
		/** 界面大小：只接受档位表里的值，主进程负责套用到主窗口。 */
		setUiZoom: (factor: number) => void;
		resetUiZoom: () => void;
	};
	activeUiThemeId: string;
	labels: {
		/** 「新会话页装饰」这块合并区域的说明，点明装饰件与纹理只影响新会话页。 */
		newSessionDecorHint: string;
		newSessionDecorTitle: string;
		ornamentHint: string;
		sections: {
			appIcon: string;
			uiZoom: string;
			language: string;
			mode: string;
			font: string;
			ornament: string;
			texture: string;
			theme: string;
			uiTheme: string;
		};
		textureHint: string;
		title: string;
		fontFamily: string;
		uiZoomSliderLabel: string;
		uiZoomReset: string;
	};
	/** 用户语言偏好（含 system），用于选择器高亮。 */
	language: LanguagePreference;
	languages: AppearanceLanguageOption[];
	mode: ThemeMode;
	modeOptions: AppearanceModeOption[];
	narrow: boolean;
	appIconOptions: AppearanceAppIconOption[];
	ornamentId: OrnamentId;
	ornamentOptions: AppearanceOrnamentOption[];
	fontOptions: AppearanceFontOption[];
	font: UiFontFamily;
	/** 是否展示「界面主题」区段（`ASTRAVIA_SHOW_UI_THEME=true`） */
	showUiTheme: boolean;
	textureId: NewSessionTextureId;
	textureOptions: AppearanceTextureOption[];
	themeName: string;
	themes: ThemeDef[];
	uiThemes: AppearanceUiThemeOption[];
	/** 界面大小：六档吸附滑块与快捷键共用同一列档位。 */
	uiZoom: {
		factor: number;
		stepIndex: number;
		steps: readonly number[];
		default: number;
	};
}

type AppearanceSettingsActions = AppearanceSettingsModel["actions"];

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

/**
 * 内置字族表。只有一档，选定后全局生效（界面、消息正文、代码块、diff、终端）。
 * 顺序按「读长文」到「写代码」排，每档都能在 macOS 与 Windows 落到近似字形。
 */
const FONT_FAMILY_OPTIONS = [
	{ id: "system" as const, labelKey: "uiFontSystemTitle", hintKey: "uiFontSystemHint" },
	{ id: "sans" as const, labelKey: "uiFontSansTitle", hintKey: "uiFontSansHint" },
	{ id: "humanist" as const, labelKey: "uiFontHumanistTitle", hintKey: "uiFontHumanistHint" },
	{ id: "geometric" as const, labelKey: "uiFontGeometricTitle", hintKey: "uiFontGeometricHint" },
	{ id: "rounded" as const, labelKey: "uiFontRoundedTitle", hintKey: "uiFontRoundedHint" },
	{ id: "serif" as const, labelKey: "uiFontSerifTitle", hintKey: "uiFontSerifHint" },
	{ id: "reading" as const, labelKey: "uiFontReadingTitle", hintKey: "uiFontReadingHint" },
	{ id: "song" as const, labelKey: "uiFontSongTitle", hintKey: "uiFontSongHint" },
	{ id: "kai" as const, labelKey: "uiFontKaiTitle", hintKey: "uiFontKaiHint" },
	{ id: "hei" as const, labelKey: "uiFontHeiTitle", hintKey: "uiFontHeiHint" },
	{ id: "mono" as const, labelKey: "uiFontMonoTitle", hintKey: "uiFontMonoHint" },
	{ id: "mono-code" as const, labelKey: "uiFontMonoCodeTitle", hintKey: "uiFontMonoCodeHint" },
] as const;

/** 原始表只有 id 与 i18n 键；这一层把当前选中态与译文并进渲染用的选项。 */
function toFontOption<T extends string>(id: T, active: boolean, label: string, hint: string): AppearanceFontOption<T> {
	return { id, active, label, hint };
}

export function useAppearanceSettingsModel(): AppearanceSettingsModel {
	const { mode, themeName, setMode, setThemeName } = useTheme();
	const { activeThemeId, availableThemes, selectTheme, status: themeRuntimeStatus } = useThemeRuntime();
	const { languagePreference, setLanguage } = useLanguage();
	const { iconId: appIconId, setIcon: setAppIcon } = useAppIcon();
	const { ornamentId, setOrnament } = useHeroOrnament();
	const { textureId, setTexture } = useNewSessionTexture();
	const { t } = useTranslation("settings");
	const narrow = useNarrowScreen();

	const { family: font, setFamily: setFont } = useUiFont();
	const { factor: uiZoomFactor, setFactor: setUiZoomFactor, reset: resetUiZoomFactor } = useUiZoom();
	const appIconOptions = useMemo<AppearanceAppIconOption[]>(
		() =>
			APP_ICON_IDS.map((id) => ({
				id,
				active: appIconId === id,
				label: t(`appIcon_${id}`),
				preview: APP_ICON_PREVIEWS[id],
			})),
		[appIconId, t],
	);

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

	const ornamentOptions = useMemo<AppearanceOrnamentOption[]>(
		() =>
			ORNAMENT_CATALOG.map((entry) => ({
				id: entry.id,
				active: ornamentId === entry.id,
				label: t(entry.labelKey),
				hint: t(entry.hintKey),
				preview: entry.preview,
			})),
		[ornamentId, t],
	);

	const textureOptions = useMemo<AppearanceTextureOption[]>(
		() =>
			NEW_SESSION_TEXTURE_CATALOG.map((entry) => ({
				id: entry.id,
				active: textureId === entry.id,
				label: t(entry.labelKey),
				hint: t(entry.hintKey),
			})),
		[t, textureId],
	);

	const fontOptions = useMemo<AppearanceFontOption[]>(
		() => FONT_FAMILY_OPTIONS.map((o) => toFontOption(o.id, font === o.id, t(o.labelKey), t(o.hintKey))),
		[t, font],
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
			newSessionDecorHint: t("newSessionDecorHint"),
			newSessionDecorTitle: t("newSessionDecorTitle"),
			ornamentHint: t("ornamentHint"),
			sections: {
				appIcon: t(SETTINGS_SECTION["appearance-app-icon"].titleKey),
				language: t(SETTINGS_SECTION["appearance-language"].titleKey),
				uiZoom: t(SETTINGS_SECTION["appearance-ui-zoom"].titleKey),
				mode: t(SETTINGS_SECTION["appearance-mode"].titleKey),
				font: t(SETTINGS_SECTION["appearance-font"].titleKey),
				ornament: t(SETTINGS_SECTION["appearance-ornament"].titleKey),
				texture: t(SETTINGS_SECTION["appearance-texture"].titleKey),
				theme: t(SETTINGS_SECTION["appearance-theme"].titleKey),
				uiTheme: t(SETTINGS_SECTION["appearance-ui-theme"].titleKey),
			},
			textureHint: t("textureHint"),
			title: t("appearanceTitle"),
			fontFamily: t("fontFamily"),
			uiZoomSliderLabel: t("uiZoomSliderLabel"),
			uiZoomReset: t("uiZoomReset"),
		}),
		[t],
	);
	const actions = useMemo<AppearanceSettingsActions>(
		() => ({
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
			setOrnament: (id) => {
				setOrnament(id);
				recordSettingsUsage({ tab: "appearance", action: "changed", target: "ornament", value: id });
			},
			setTexture: (id) => {
				setTexture(id);
				recordSettingsUsage({ tab: "appearance", action: "changed", target: "new-session-texture", value: id });
			},
			setAppIcon: (id) => {
				setAppIcon(id);
				recordSettingsUsage({ tab: "appearance", action: "changed", target: "app-icon", value: id });
			},
			setFont: (family) => {
				setFont(family);
				recordSettingsUsage({ tab: "appearance", action: "changed", target: "font", value: family });
			},
			setUiZoom: (factor) => {
				setUiZoomFactor(factor);
				recordSettingsUsage({ tab: "appearance", action: "changed", target: "ui-zoom", value: String(factor) });
			},
			resetUiZoom: () => {
				resetUiZoomFactor();
				recordSettingsUsage({
					tab: "appearance",
					action: "changed",
					target: "ui-zoom",
					value: String(UI_ZOOM_DEFAULT),
				});
			},
		}),
		[
			selectTheme,
			setAppIcon,
			setLanguage,
			setMode,
			setOrnament,
			setTexture,
			setThemeName,
			setFont,
			setUiZoomFactor,
			resetUiZoomFactor,
		],
	);

	return {
		actions,
		activeUiThemeId: activeThemeId,
		labels,
		language: languagePreference,
		languages,
		mode,
		modeOptions,
		narrow,
		appIconOptions,
		ornamentId,
		ornamentOptions,
		showUiTheme: isAppearanceUiThemeEnabled(),
		textureId,
		textureOptions,
		themeName,
		themes,
		font,
		fontOptions,
		uiThemes,
		uiZoom: {
			factor: uiZoomFactor,
			stepIndex: uiZoomStepIndex(uiZoomFactor),
			steps: UI_ZOOM_STEPS,
			default: UI_ZOOM_DEFAULT,
		},
	};
}
