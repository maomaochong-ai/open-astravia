import { layoutMockup } from "./layout";
import type { MockupLayout, MockupOptions, MockupRect, MockupShot } from "./types";

/** Brand wordmark. Baked into the bitmap, so it is deliberately not localized. */
const BRAND_NAME = "Vetta";
const BRAND_TAGLINE = "Designed By Vetta";

function roundRectPath(g: CanvasRenderingContext2D, rect: MockupRect, radius: number): void {
	const r = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
	g.beginPath();
	g.moveTo(rect.x + r, rect.y);
	g.arcTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + rect.height, r);
	g.arcTo(rect.x + rect.width, rect.y + rect.height, rect.x, rect.y + rect.height, r);
	g.arcTo(rect.x, rect.y + rect.height, rect.x, rect.y, r);
	g.arcTo(rect.x, rect.y, rect.x + rect.width, rect.y, r);
	g.closePath();
}

function outset(rect: MockupRect, by: number): MockupRect {
	return { x: rect.x - by, y: rect.y - by, width: rect.width + by * 2, height: rect.height + by * 2 };
}

/**
 * Wordmark ink that survives whatever background the user picked. Unknown color
 * syntaxes fall back to light ink, matching the dark default background.
 */
function brandInk(options: MockupOptions): { primary: string; secondary: string } {
	const light = { primary: "#ffffff", secondary: "rgba(255, 255, 255, 0.55)" };
	const dark = { primary: "#111114", secondary: "rgba(17, 17, 20, 0.55)" };
	// A transparent export usually gets dropped onto a light document.
	if (options.transparent) return dark;
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(options.background.trim());
	if (!hex) return light;
	const digits = hex[1].length === 3 ? [...hex[1]].map((char) => char + char).join("") : hex[1];
	const value = Number.parseInt(digits, 16);
	const luminance =
		(0.2126 * ((value >> 16) & 0xff) + 0.7152 * ((value >> 8) & 0xff) + 0.0722 * (value & 0xff)) / 255;
	return luminance > 0.55 ? dark : light;
}

/**
 * Paint one composition. The single renderer behind both the dialog preview and
 * the exported file — the preview just calls it with a smaller `scale`.
 *
 * Device shell: the border is drawn as a filled rounded rect UNDER the
 * screenshot and outset by its width, so the inner and outer radii stay
 * concentric and no interface pixel is covered.
 */
export function renderMockup(
	g: CanvasRenderingContext2D,
	shots: MockupShot[],
	options: MockupOptions,
	layout: MockupLayout,
	scale: number,
	brandLogo: CanvasImageSource | null,
): void {
	g.save();
	g.clearRect(0, 0, layout.width * scale, layout.height * scale);
	g.scale(scale, scale);

	if (!options.transparent) {
		g.fillStyle = options.background;
		g.fillRect(0, 0, layout.width, layout.height);
	}

	if (layout.brand && options.brand) {
		drawBrand(g, layout.brand, brandLogo, brandInk(options));
	}

	const border = Math.max(0, options.borderWidth);
	shots.forEach((shot, index) => {
		const rect = layout.rects[index];
		if (!rect) return;
		const shell = outset(rect, border);

		if (options.shadow) {
			g.save();
			// Shadow hangs off the outermost silhouette; softness follows the size
			// so it reads the same whether the export is a phone or a desktop shot.
			g.shadowColor = "rgba(0, 0, 0, 0.45)";
			g.shadowBlur = shell.height * 0.06;
			g.shadowOffsetY = shell.height * 0.02;
			g.fillStyle = border > 0 ? options.borderColor : "#000000";
			roundRectPath(g, shell, options.radius + border);
			g.fill();
			g.restore();
		}

		if (border > 0) {
			g.fillStyle = options.borderColor;
			roundRectPath(g, shell, options.radius + border);
			g.fill();
		}

		g.save();
		roundRectPath(g, rect, options.radius);
		g.clip();
		if (shot.image) {
			g.drawImage(shot.image, rect.x, rect.y, rect.width, rect.height);
		} else {
			// Capture pending or failed: keep the slot so the composition does not
			// reflow once it arrives. The dialog blocks export while any slot is empty.
			g.fillStyle = "#8a8a8f";
			g.fillRect(rect.x, rect.y, rect.width, rect.height);
		}
		g.restore();
	});

	g.restore();
}

function drawBrand(
	g: CanvasRenderingContext2D,
	brand: NonNullable<MockupLayout["brand"]>,
	logo: CanvasImageSource | null,
	ink: { primary: string; secondary: string },
): void {
	const size = brand.logo;
	if (logo) {
		g.save();
		roundRectPath(g, { x: brand.x, y: brand.y, width: size, height: size }, size * 0.24);
		g.clip();
		g.drawImage(logo, brand.x, brand.y, size, size);
		g.restore();
	}

	const textX = brand.x + size * 1.24;
	g.save();
	g.textBaseline = "alphabetic";
	g.fillStyle = ink.primary;
	g.font = `600 ${size * 0.46}px system-ui, -apple-system, "Segoe UI", sans-serif`;
	g.fillText(BRAND_NAME, textX, brand.y + size * 0.44);
	g.fillStyle = ink.secondary;
	g.font = `400 ${size * 0.28}px system-ui, -apple-system, "Segoe UI", sans-serif`;
	g.fillText(BRAND_TAGLINE, textX, brand.y + size * 0.82);
	g.restore();
}

/** Compose to an offscreen canvas and hand back a PNG data URL. */
export function renderMockupToDataUrl(
	shots: MockupShot[],
	options: MockupOptions,
	brandLogo: CanvasImageSource | null,
): string {
	const layout = layoutMockup(shots, options);
	const scale = options.scale * layout.fit;
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(layout.width * scale));
	canvas.height = Math.max(1, Math.round(layout.height * scale));
	const g = canvas.getContext("2d");
	if (!g) throw new Error("2D canvas context unavailable");
	renderMockup(g, shots, options, layout, scale, brandLogo);
	return canvas.toDataURL("image/png");
}
