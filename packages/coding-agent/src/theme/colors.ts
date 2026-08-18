import type { ColorMode, ColorValue } from "./contracts.js";

const CUBE_VALUES = [0, 95, 135, 175, 215, 255];
const GRAY_VALUES = Array.from({ length: 24 }, (_, index) => 8 + index * 10);

export function detectColorMode(environment: Readonly<Record<string, string | undefined>> = {}): ColorMode {
	if (environment.COLORTERM === "truecolor" || environment.COLORTERM === "24bit" || environment.WT_SESSION) {
		return "truecolor";
	}
	const term = environment.TERM ?? "";
	if (term === "dumb" || term === "" || term === "linux" || environment.TERM_PROGRAM === "Apple_Terminal") {
		return "256color";
	}
	return "truecolor";
}

export function detectTerminalBackground(
	environment: Readonly<Record<string, string | undefined>> = {},
): "dark" | "light" {
	const colorfgbg = environment.COLORFGBG ?? "";
	if (colorfgbg) {
		const parts = colorfgbg.split(";");
		if (parts.length >= 2) {
			const background = Number.parseInt(parts[1], 10);
			if (!Number.isNaN(background)) return background < 8 ? "dark" : "light";
		}
	}
	return "dark";
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const cleaned = hex.replace("#", "");
	if (cleaned.length !== 6) throw new Error(`Invalid hex color: ${hex}`);
	const r = Number.parseInt(cleaned.substring(0, 2), 16);
	const g = Number.parseInt(cleaned.substring(2, 4), 16);
	const b = Number.parseInt(cleaned.substring(4, 6), 16);
	if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) throw new Error(`Invalid hex color: ${hex}`);
	return { r, g, b };
}

function findClosestIndex(value: number, candidates: readonly number[]): number {
	let closestDistance = Number.POSITIVE_INFINITY;
	let closestIndex = 0;
	for (let index = 0; index < candidates.length; index++) {
		const distance = Math.abs(value - candidates[index]);
		if (distance < closestDistance) {
			closestDistance = distance;
			closestIndex = index;
		}
	}
	return closestIndex;
}

function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
	const dr = r1 - r2;
	const dg = g1 - g2;
	const db = b1 - b2;
	return dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
}

export function rgbTo256(r: number, g: number, b: number): number {
	const rIndex = findClosestIndex(r, CUBE_VALUES);
	const gIndex = findClosestIndex(g, CUBE_VALUES);
	const bIndex = findClosestIndex(b, CUBE_VALUES);
	const cubeIndex = 16 + 36 * rIndex + 6 * gIndex + bIndex;
	const cubeDistance = colorDistance(r, g, b, CUBE_VALUES[rIndex], CUBE_VALUES[gIndex], CUBE_VALUES[bIndex]);

	const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
	const grayRampIndex = findClosestIndex(gray, GRAY_VALUES);
	const grayValue = GRAY_VALUES[grayRampIndex];
	const grayDistance = colorDistance(r, g, b, grayValue, grayValue, grayValue);
	if (Math.max(r, g, b) - Math.min(r, g, b) < 10 && grayDistance < cubeDistance) {
		return 232 + grayRampIndex;
	}
	return cubeIndex;
}

function hexTo256(hex: string): number {
	const { r, g, b } = hexToRgb(hex);
	return rgbTo256(r, g, b);
}

export function foregroundAnsi(color: string | number, mode: ColorMode): string {
	if (color === "") return "\x1b[39m";
	if (typeof color === "number") return `\x1b[38;5;${color}m`;
	if (!color.startsWith("#")) throw new Error(`Invalid color value: ${color}`);
	if (mode === "256color") return `\x1b[38;5;${hexTo256(color)}m`;
	const { r, g, b } = hexToRgb(color);
	return `\x1b[38;2;${r};${g};${b}m`;
}

export function backgroundAnsi(color: string | number, mode: ColorMode): string {
	if (color === "") return "\x1b[49m";
	if (typeof color === "number") return `\x1b[48;5;${color}m`;
	if (!color.startsWith("#")) throw new Error(`Invalid color value: ${color}`);
	if (mode === "256color") return `\x1b[48;5;${hexTo256(color)}m`;
	const { r, g, b } = hexToRgb(color);
	return `\x1b[48;2;${r};${g};${b}m`;
}

function resolveVariable(
	value: ColorValue,
	variables: Readonly<Record<string, ColorValue>>,
	visited = new Set<string>(),
): ColorValue {
	if (typeof value === "number" || value === "" || value.startsWith("#")) return value;
	if (visited.has(value)) throw new Error(`Circular variable reference detected: ${value}`);
	if (!(value in variables)) throw new Error(`Variable reference not found: ${value}`);
	visited.add(value);
	return resolveVariable(variables[value], variables, visited);
}

export function resolveThemeColors<T extends Record<string, ColorValue>>(
	colors: T,
	variables: Readonly<Record<string, ColorValue>> = {},
): Record<keyof T, ColorValue> {
	const resolved: Record<string, ColorValue> = {};
	for (const [key, value] of Object.entries(colors)) resolved[key] = resolveVariable(value, variables);
	return resolved as Record<keyof T, ColorValue>;
}

export function ansi256ToHex(index: number): string {
	const basicColors = [
		"#000000",
		"#800000",
		"#008000",
		"#808000",
		"#000080",
		"#800080",
		"#008080",
		"#c0c0c0",
		"#808080",
		"#ff0000",
		"#00ff00",
		"#ffff00",
		"#0000ff",
		"#ff00ff",
		"#00ffff",
		"#ffffff",
	];
	if (index < 16) return basicColors[index];
	if (index < 232) {
		const cubeIndex = index - 16;
		const r = Math.floor(cubeIndex / 36);
		const g = Math.floor((cubeIndex % 36) / 6);
		const b = cubeIndex % 6;
		const toHex = (value: number) => (value === 0 ? 0 : 55 + value * 40).toString(16).padStart(2, "0");
		return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
	}
	const gray = 8 + (index - 232) * 10;
	const grayHex = gray.toString(16).padStart(2, "0");
	return `#${grayHex}${grayHex}${grayHex}`;
}
