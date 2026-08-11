import { getResolvedThemeColors, getThemeExportColors } from "../modes/interactive/theme/theme.js";
import type { HtmlExportTheme, HtmlExportThemeSource } from "./contracts.js";

export class CodingAgentHtmlExportThemeSource implements HtmlExportThemeSource {
	resolve(themeName?: string): HtmlExportTheme {
		const colors = getResolvedThemeColors(themeName);
		const exportColors = getThemeExportColors(themeName);
		return {
			colors,
			pageBg: exportColors.pageBg,
			cardBg: exportColors.cardBg,
			infoBg: exportColors.infoBg,
		};
	}
}
