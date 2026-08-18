import chalk from "chalk";
import { backgroundAnsi, foregroundAnsi } from "./colors.js";
import type { ColorMode, ThemeBg, ThemeColor } from "./contracts.js";
import type { ThemeDocument } from "./schema.js";

export class Theme {
	readonly name?: string;
	readonly sourcePath?: string;
	private readonly foregroundColors = new Map<ThemeColor, string>();
	private readonly backgroundColors = new Map<ThemeBg, string>();

	constructor(
		foregroundColors: Record<ThemeColor, string | number>,
		backgroundColors: Record<ThemeBg, string | number>,
		private readonly mode: ColorMode,
		options: { name?: string; sourcePath?: string; sourceDocument?: ThemeDocument } = {},
	) {
		this.name = options.name;
		this.sourcePath = options.sourcePath;
		this.sourceDocument = options.sourceDocument;
		for (const [key, value] of Object.entries(foregroundColors) as [ThemeColor, string | number][]) {
			this.foregroundColors.set(key, foregroundAnsi(value, mode));
		}
		for (const [key, value] of Object.entries(backgroundColors) as [ThemeBg, string | number][]) {
			this.backgroundColors.set(key, backgroundAnsi(value, mode));
		}
	}

	private readonly sourceDocument: ThemeDocument | undefined;

	/** Original validated document used by non-terminal projections such as HTML export. */
	getSourceDocument(): ThemeDocument | undefined {
		return this.sourceDocument;
	}

	fg(color: ThemeColor, text: string): string {
		return `${this.getFgAnsi(color)}${text}\x1b[39m`;
	}

	bg(color: ThemeBg, text: string): string {
		return `${this.getBgAnsi(color)}${text}\x1b[49m`;
	}

	bold(text: string): string {
		return chalk.bold(text);
	}

	italic(text: string): string {
		return chalk.italic(text);
	}

	underline(text: string): string {
		return chalk.underline(text);
	}

	inverse(text: string): string {
		return chalk.inverse(text);
	}

	strikethrough(text: string): string {
		return chalk.strikethrough(text);
	}

	getFgAnsi(color: ThemeColor): string {
		const ansi = this.foregroundColors.get(color);
		if (!ansi) throw new Error(`Unknown theme color: ${color}`);
		return ansi;
	}

	getBgAnsi(color: ThemeBg): string {
		const ansi = this.backgroundColors.get(color);
		if (!ansi) throw new Error(`Unknown theme background color: ${color}`);
		return ansi;
	}

	getColorMode(): ColorMode {
		return this.mode;
	}

	getThinkingBorderColor(level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh"): (text: string) => string {
		const color = THINKING_COLOR_BY_LEVEL[level] ?? "thinkingOff";
		return (text) => this.fg(color, text);
	}

	getBashModeBorderColor(): (text: string) => string {
		return (text) => this.fg("bashMode", text);
	}
}

const THINKING_COLOR_BY_LEVEL: Readonly<Record<string, ThemeColor>> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
};
