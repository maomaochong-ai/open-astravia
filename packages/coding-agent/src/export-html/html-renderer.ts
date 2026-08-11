import type { ExportTemplateAssetsSource, HtmlExportThemeSource } from "./contracts.js";
import type { HtmlExportDocument } from "./export-document.js";

export interface HtmlDocumentRendererOptions {
	readonly assets: ExportTemplateAssetsSource;
	readonly themes: HtmlExportThemeSource;
}

export class HtmlDocumentRenderer {
	constructor(private readonly options: HtmlDocumentRendererOptions) {}

	render(document: HtmlExportDocument, themeName?: string): string {
		const assets = this.options.assets.load();
		const theme = this.options.themes.resolve(themeName);
		const derived = deriveExportColors(theme.colors.userMessageBg || "#343541");
		const pageBg = theme.pageBg ?? derived.pageBg;
		const cardBg = theme.cardBg ?? derived.cardBg;
		const infoBg = theme.infoBg ?? derived.infoBg;
		const themeVars = Object.entries(theme.colors)
			.map(([key, value]) => `--${key}: ${value};`)
			.concat([`--exportPageBg: ${pageBg};`, `--exportCardBg: ${cardBg};`, `--exportInfoBg: ${infoBg};`])
			.join("\n      ");
		const css = assets.css
			.replace("{{THEME_VARS}}", themeVars)
			.replace("{{BODY_BG}}", pageBg)
			.replace("{{CONTAINER_BG}}", cardBg)
			.replace("{{INFO_BG}}", infoBg);
		const sessionData = Buffer.from(JSON.stringify(document)).toString("base64");
		return assets.template
			.replace("{{CSS}}", css)
			.replace("{{JS}}", assets.js)
			.replace("{{SESSION_DATA}}", sessionData)
			.replace("{{MARKED_JS}}", assets.markedJs)
			.replace("{{HIGHLIGHT_JS}}", assets.highlightJs);
	}
}

function deriveExportColors(baseColor: string): {
	readonly pageBg: string;
	readonly cardBg: string;
	readonly infoBg: string;
} {
	const parsed = parseColor(baseColor);
	if (!parsed) {
		return { pageBg: "rgb(24, 24, 30)", cardBg: "rgb(30, 30, 36)", infoBg: "rgb(60, 55, 40)" };
	}
	if (getLuminance(parsed.r, parsed.g, parsed.b) > 0.5) {
		return {
			pageBg: adjustBrightness(baseColor, 0.96),
			cardBg: baseColor,
			infoBg: `rgb(${Math.min(255, parsed.r + 10)}, ${Math.min(255, parsed.g + 5)}, ${Math.max(0, parsed.b - 20)})`,
		};
	}
	return {
		pageBg: adjustBrightness(baseColor, 0.7),
		cardBg: adjustBrightness(baseColor, 0.85),
		infoBg: `rgb(${Math.min(255, parsed.r + 20)}, ${Math.min(255, parsed.g + 15)}, ${parsed.b})`,
	};
}

function parseColor(color: string): { readonly r: number; readonly g: number; readonly b: number } | undefined {
	const hex = color.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
	if (hex) {
		return { r: Number.parseInt(hex[1], 16), g: Number.parseInt(hex[2], 16), b: Number.parseInt(hex[3], 16) };
	}
	const rgb = color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
	return rgb
		? { r: Number.parseInt(rgb[1], 10), g: Number.parseInt(rgb[2], 10), b: Number.parseInt(rgb[3], 10) }
		: undefined;
}

function getLuminance(r: number, g: number, b: number): number {
	const toLinear = (component: number) => {
		const value = component / 255;
		return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function adjustBrightness(color: string, factor: number): string {
	const parsed = parseColor(color);
	if (!parsed) return color;
	const adjust = (component: number) => Math.min(255, Math.max(0, Math.round(component * factor)));
	return `rgb(${adjust(parsed.r)}, ${adjust(parsed.g)}, ${adjust(parsed.b)})`;
}
