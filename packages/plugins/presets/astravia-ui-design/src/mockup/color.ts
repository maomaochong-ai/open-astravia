/**
 * Color helpers for the export dialog's picker.
 *
 * Theme swatches come straight out of the design's own theme.css, so they can be
 * any CSS color syntax (`oklch(...)`, `hsl(...)`, a named color). The picker
 * works in hex, so everything is normalized through a 1x1 canvas — the browser
 * is the only parser that knows every syntax.
 */

let probe: CanvasRenderingContext2D | null | undefined;

function context(): CanvasRenderingContext2D | null {
	if (probe === undefined) {
		const canvas = document.createElement("canvas");
		canvas.width = 1;
		canvas.height = 1;
		probe = canvas.getContext("2d", { willReadFrequently: true });
	}
	return probe;
}

function channel(value: number): string {
	return Math.round(Math.min(255, Math.max(0, value)))
		.toString(16)
		.padStart(2, "0");
}

export function rgbToHex(r: number, g: number, b: number): string {
	return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Normalize any CSS color to `#rrggbb`; unparseable input falls back to black. */
export function toHex(value: string): string {
	if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
	const ctx = context();
	if (!ctx) return "#000000";
	ctx.clearRect(0, 0, 1, 1);
	// Seed with black: an invalid assignment leaves fillStyle untouched.
	ctx.fillStyle = "#000000";
	ctx.fillStyle = value;
	ctx.fillRect(0, 0, 1, 1);
	const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
	return rgbToHex(r, g, b);
}

export interface Hsv {
	/** 0-360 */
	h: number;
	/** 0-1 */
	s: number;
	/** 0-1 */
	v: number;
}

export function hexToHsv(hex: string): Hsv {
	const normalized = toHex(hex);
	const r = Number.parseInt(normalized.slice(1, 3), 16) / 255;
	const g = Number.parseInt(normalized.slice(3, 5), 16) / 255;
	const b = Number.parseInt(normalized.slice(5, 7), 16) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;
	let h = 0;
	if (delta !== 0) {
		if (max === r) h = ((g - b) / delta) % 6;
		else if (max === g) h = (b - r) / delta + 2;
		else h = (r - g) / delta + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
	const c = v * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = v - c;
	const sector = Math.floor((h % 360) / 60);
	const [r, g, b] = (
		[
			[c, x, 0],
			[x, c, 0],
			[0, c, x],
			[0, x, c],
			[x, 0, c],
			[c, 0, x],
		] as const
	)[sector < 0 ? 0 : sector];
	return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
