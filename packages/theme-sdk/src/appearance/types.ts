export interface ThemeSurfaceRegistry {}

export type ThemeSurfaceSlot = Extract<keyof ThemeSurfaceRegistry, string>;

export interface ThemeColorTokens {
	readonly accent: string;
	readonly accentForeground: string;
	readonly background: string;
	readonly border: string;
	readonly card: string;
	readonly cardForeground: string;
	readonly chart1: string;
	readonly chart2: string;
	readonly chart3: string;
	readonly chart4: string;
	readonly chart5: string;
	readonly destructive: string;
	readonly destructiveForeground: string;
	readonly foreground: string;
	readonly input: string;
	/** AI 输入栏及其附属浮层（命令面板 / @ 面板 / ledge）的底色。浅色为纯白，深色跟随 card。 */
	readonly inputBarBg: string;
	readonly muted: string;
	readonly mutedForeground: string;
	readonly popover: string;
	readonly popoverForeground: string;
	readonly primary: string;
	readonly primaryForeground: string;
	readonly ring: string;
	readonly secondary: string;
	readonly secondaryForeground: string;
}

export interface ThemeColorOverrides {
	readonly common?: Partial<ThemeColorTokens>;
	readonly dark?: Partial<ThemeColorTokens>;
	readonly light?: Partial<ThemeColorTokens>;
}

export interface BackgroundImageFrameDecoration {
	readonly position?: string;
	readonly repeat?: "no-repeat" | "repeat" | "repeat-x" | "repeat-y";
	readonly size?: "contain" | "cover" | string;
}

export interface BackgroundImageSurfaceFrame {
	readonly kind: "background-image";
	readonly decoration?: BackgroundImageFrameDecoration;
	readonly imageUrl: string;
}

export interface CornerImageFrameCorner {
	readonly backgroundPosition: string;
	readonly id: string;
	readonly position: {
		readonly bottom?: string;
		readonly left?: string;
		readonly right?: string;
		readonly top?: string;
	};
}

export interface CornerImageFrameDecoration {
	readonly backgroundSize: string;
	readonly cornerHeight: string;
	readonly corners: readonly CornerImageFrameCorner[];
	readonly cornerWidth: string;
}

export interface CornerImageSurfaceFrame {
	readonly kind: "corner-image";
	readonly decoration: CornerImageFrameDecoration;
	readonly imageUrl: string;
}

export interface NineSliceImageFrameDecoration {
	readonly borderWidth: string;
	readonly outset?: string;
	readonly repeat?: "repeat" | "round" | "space" | "stretch";
	readonly slice: number | string;
}

export interface NineSliceImageSurfaceFrame {
	readonly kind: "nine-slice-image";
	readonly decoration: NineSliceImageFrameDecoration;
	readonly imageUrl: string;
}

export interface HorizontalSliceImageFrameDecoration {
	readonly height?: string;
	readonly leftSlice: number | string;
	readonly leftWidth: string;
	readonly repeat?: "repeat" | "round" | "space" | "stretch";
	readonly rightSlice: number | string;
	readonly rightWidth: string;
}

export interface HorizontalSliceImageSurfaceFrame {
	readonly kind: "horizontal-slice-image";
	readonly decoration: HorizontalSliceImageFrameDecoration;
	readonly imageUrl: string;
}

export type ThemeSurfaceFrame =
	| BackgroundImageSurfaceFrame
	| CornerImageSurfaceFrame
	| HorizontalSliceImageSurfaceFrame
	| NineSliceImageSurfaceFrame;

export interface ThemeSurfaceConfig {
	readonly frame?: ThemeSurfaceFrame;
	readonly rootClassName?: string;
	readonly surfaceClassName?: string;
}

export interface ThemeAppearance {
	/**
	 * 主题偏好的显示模式。desktop-app host 在激活主题时会强制应用对应 light/dark
	 *（写入显示模式设置与 `data-mode`），而不仅是 CSS `color-scheme`。
	 */
	readonly colorScheme?: "dark" | "light";
	readonly colors?: ThemeColorOverrides;
	readonly surfaces?: Partial<Record<ThemeSurfaceSlot, ThemeSurfaceConfig>>;
}

export const DEFAULT_THEME_APPEARANCE: ThemeAppearance = {
	surfaces: {},
};
