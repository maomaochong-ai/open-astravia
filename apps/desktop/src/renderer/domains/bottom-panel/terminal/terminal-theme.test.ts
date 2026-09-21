import { describe, expect, it } from "vitest";
import { selectTerminalRenderer } from "./select-terminal-renderer";
import { buildTerminalTheme } from "./terminal-theme";

function reader(values: Record<string, string>) {
	return (name: string) => values[name] ?? "";
}

describe("buildTerminalTheme", () => {
	it("把 token 解析成具体色值（xterm 不认 var()）", () => {
		const theme = buildTerminalTheme(
			reader({ "--background": "rgb(1, 2, 3)", "--foreground": "rgb(4, 5, 6)", "--term-red": "rgb(9, 9, 9)" }),
		);

		expect(theme.background).toBe("rgb(1, 2, 3)");
		expect(theme.foreground).toBe("rgb(4, 5, 6)");
		expect(theme.red).toBe("rgb(9, 9, 9)");
	});

	it("变量缺失时用 fallback，而不是留空让 xterm 用自带配色", () => {
		const theme = buildTerminalTheme(reader({}));

		expect(theme.background).toBeTruthy();
		expect(theme.brightWhite).toBeTruthy();
		expect(theme.blue).toBeTruthy();
	});

	it("光标用主色，选区用主色的半透明叠加", () => {
		const theme = buildTerminalTheme(reader({ "--primary": "rgb(10, 20, 30)" }));

		expect(theme.cursor).toBe("rgb(10, 20, 30)");
		expect(theme.selectionBackground).toContain("rgb(10, 20, 30)");
	});

	it("解析出完整 16 色，缺一个都会让部分输出失色", () => {
		const theme = buildTerminalTheme(reader({}));
		const ansi = [
			theme.black,
			theme.red,
			theme.green,
			theme.yellow,
			theme.blue,
			theme.magenta,
			theme.cyan,
			theme.white,
			theme.brightBlack,
			theme.brightRed,
			theme.brightGreen,
			theme.brightYellow,
			theme.brightBlue,
			theme.brightMagenta,
			theme.brightCyan,
			theme.brightWhite,
		];

		expect(ansi.filter(Boolean)).toHaveLength(16);
	});
});

describe("selectTerminalRenderer", () => {
	it("只有当前活动格用 WebGL，避免多开终端互相踢掉上下文", () => {
		const base = { hasWebgl2: true, hardwareAccelerated: true };

		expect(selectTerminalRenderer({ ...base, isActiveLeaf: true })).toBe("webgl");
		expect(selectTerminalRenderer({ ...base, isActiveLeaf: false })).toBe("canvas");
	});

	it("拿不到 webgl2 或关了硬件加速时一律 canvas", () => {
		expect(selectTerminalRenderer({ hasWebgl2: false, hardwareAccelerated: true, isActiveLeaf: true })).toBe(
			"canvas",
		);
		expect(selectTerminalRenderer({ hasWebgl2: true, hardwareAccelerated: false, isActiveLeaf: true })).toBe(
			"canvas",
		);
	});

	it("丢过一次上下文就不再回 WebGL", () => {
		expect(
			selectTerminalRenderer({ hasWebgl2: true, hardwareAccelerated: true, isActiveLeaf: true, contextLost: true }),
		).toBe("canvas");
	});
});
