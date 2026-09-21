import type { ITheme } from "@xterm/xterm";

/**
 * 把 CSS token 折算成 xterm 的主题。
 *
 * xterm 只吃具体色值，不认 `var(--x)`，所以必须在挂载时解析一次，并在明暗切换后
 * 重新解析。缺失的变量走 fallback 而不是留空——留空会让 xterm 用它自己的默认配色，
 * 表现为终端配色和应用整体脱节。
 */

export type CssVariableReader = (name: string) => string;

const FALLBACKS: Record<string, string> = {
	"--background": "#14161e",
	"--foreground": "#dce0ea",
	"--primary": "#7aa2f7",
	"--muted-foreground": "#8b91a1",
	"--term-black": "#2d303a",
	"--term-red": "#ed7676",
	"--term-green": "#81c784",
	"--term-yellow": "#e5c07b",
	"--term-blue": "#7aa2f7",
	"--term-magenta": "#bb9af7",
	"--term-cyan": "#7dcfff",
	"--term-white": "#c0c5d1",
	"--term-bright-black": "#5a5f6e",
	"--term-bright-red": "#f79191",
	"--term-bright-green": "#9ed8a1",
	"--term-bright-yellow": "#efd296",
	"--term-bright-blue": "#97b8ff",
	"--term-bright-magenta": "#cdb4fa",
	"--term-bright-cyan": "#a0dfff",
	"--term-bright-white": "#e6eaf3",
};

function readColor(read: CssVariableReader, name: string): string {
	const value = read(name).trim();
	return value || (FALLBACKS[name] ?? "#000000");
}

export function buildTerminalTheme(read: CssVariableReader): ITheme {
	const background = readColor(read, "--background");
	const foreground = readColor(read, "--foreground");
	const primary = readColor(read, "--primary");
	return {
		background,
		foreground,
		cursor: primary,
		cursorAccent: background,
		// 选区用主色的半透明叠加，跟 UI 的选中态同源。
		selectionBackground: `color-mix(in srgb, ${primary} 30%, transparent)`,
		black: readColor(read, "--term-black"),
		red: readColor(read, "--term-red"),
		green: readColor(read, "--term-green"),
		yellow: readColor(read, "--term-yellow"),
		blue: readColor(read, "--term-blue"),
		magenta: readColor(read, "--term-magenta"),
		cyan: readColor(read, "--term-cyan"),
		white: readColor(read, "--term-white"),
		brightBlack: readColor(read, "--term-bright-black"),
		brightRed: readColor(read, "--term-bright-red"),
		brightGreen: readColor(read, "--term-bright-green"),
		brightYellow: readColor(read, "--term-bright-yellow"),
		brightBlue: readColor(read, "--term-bright-blue"),
		brightMagenta: readColor(read, "--term-bright-magenta"),
		brightCyan: readColor(read, "--term-bright-cyan"),
		brightWhite: readColor(read, "--term-bright-white"),
	};
}

export function createDocumentCssVariableReader(element: Element): CssVariableReader {
	const style = getComputedStyle(element);
	return (name) => style.getPropertyValue(name);
}
