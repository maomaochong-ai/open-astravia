import claudeIcon from "@lobehub/icons-static-svg/icons/claude-color.svg?url";
import deepseekIcon from "@lobehub/icons-static-svg/icons/deepseek-color.svg?url";
import geminiIcon from "@lobehub/icons-static-svg/icons/gemini-color.svg?url";
import grokIcon from "@lobehub/icons-static-svg/icons/grok.svg?url";
import kimiIcon from "@lobehub/icons-static-svg/icons/kimi-color.svg?url";
import minimaxIcon from "@lobehub/icons-static-svg/icons/minimax-color.svg?url";
import nvidiaIcon from "@lobehub/icons-static-svg/icons/nvidia-color.svg?url";
import ollamaIcon from "@lobehub/icons-static-svg/icons/ollama.svg?url";
import openaiIcon from "@lobehub/icons-static-svg/icons/openai.svg?url";
import opencodeIcon from "@lobehub/icons-static-svg/icons/opencode.svg?url";
import qwenIcon from "@lobehub/icons-static-svg/icons/qwen-color.svg?url";
import xiaomiMimoIcon from "@lobehub/icons-static-svg/icons/xiaomimimo.svg?url";
import zaiIcon from "@lobehub/icons-static-svg/icons/zai.svg?url";
import zhipuIcon from "@lobehub/icons-static-svg/icons/zhipu-color.svg?url";

type ProviderIconAppearance = "color" | "monochrome";

interface ProviderIconAsset {
	readonly src: string;
	readonly appearance: ProviderIconAppearance;
}

const PROVIDER_ICON_ASSETS = {
	claude: { src: claudeIcon, appearance: "color" },
	openai: { src: openaiIcon, appearance: "monochrome" },
	gemini: { src: geminiIcon, appearance: "color" },
	deepseek: { src: deepseekIcon, appearance: "color" },
	grok: { src: grokIcon, appearance: "monochrome" },
	qwen: { src: qwenIcon, appearance: "color" },
	kimi: { src: kimiIcon, appearance: "color" },
	minimax: { src: minimaxIcon, appearance: "color" },
	nvidia: { src: nvidiaIcon, appearance: "color" },
	ollama: { src: ollamaIcon, appearance: "monochrome" },
	xiaomi: { src: xiaomiMimoIcon, appearance: "monochrome" },
	zai: { src: zaiIcon, appearance: "monochrome" },
	zhipu: { src: zhipuIcon, appearance: "color" },
	opencode: { src: opencodeIcon, appearance: "monochrome" },
} as const satisfies Record<string, ProviderIconAsset>;

/**
 * 供应商 symbol 到打包后资源 URL 的公共映射。
 * SVG 源文件来自依赖包，由构建工具收集，不存放在仓库中。
 */
export const PROVIDER_ICONS: Record<string, string> = Object.fromEntries(
	Object.entries(PROVIDER_ICON_ASSETS).map(([symbol, asset]) => [symbol, asset.src]),
);

export function getProviderIcon(symbol: string | undefined | null): string | undefined {
	if (!symbol || !Object.hasOwn(PROVIDER_ICONS, symbol)) return undefined;
	return PROVIDER_ICONS[symbol];
}

export function isMonochromeProviderIcon(symbol: string | undefined | null): boolean {
	if (!symbol || !Object.hasOwn(PROVIDER_ICON_ASSETS, symbol)) return false;
	return PROVIDER_ICON_ASSETS[symbol as keyof typeof PROVIDER_ICON_ASSETS].appearance === "monochrome";
}
