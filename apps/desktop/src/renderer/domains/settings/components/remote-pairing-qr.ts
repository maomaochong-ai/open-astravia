import QRCode from "qrcode";

/**
 * Share of the code's width left clear at the centre for the badge laid over it: wider
 * under high error correction (30%), narrower under medium (15%). Either way the cleared
 * centre stays well inside what the code can recover.
 */
const BADGE_SHARE = { H: 0.3, M: 0.22 } as const;

/** Past this many modules a high-level code is too dense; fall back to M. */
const MAX_HIGH_MODULES = 33;

/** How far a module reaches into a dark neighbour, in modules. */
const SEAM = 0.04;

/** The three finder patterns are 7×7 modules in the top-left, top-right and bottom-left corners. */
const FINDER = 7;

export interface QrMatrix {
	readonly size: number;
	/** Diameter, in modules, of the centre left clear for the badge. */
	readonly badgeModules: number;
	isDark(row: number, col: number): boolean;
}

/**
 * The pairing QR code, drawn in the rounded style: neighbouring modules run together,
 * lone ends are rounded, the three corner squares are rounded frames, and the centre is
 * left clear for a badge. A short text (the connection code, ADR-0138) gets high error
 * correction (30%), which also gives it a few more modules than the bare minimum so it
 * does not look sparse, and room for a larger badge; a whole pairing URI gets medium
 * (15%) so it stays as sparse as it can.
 */
export function pairingQrSvg(text: string): {
	readonly svg: string;
	readonly size: number;
	readonly badgeModules: number;
} {
	const high = QRCode.create(text, { errorCorrectionLevel: "H" });
	const level = high.modules.size <= MAX_HIGH_MODULES ? "H" : "M";
	const qr = level === "H" ? high : QRCode.create(text, { errorCorrectionLevel: "M" });
	const { size, data } = qr.modules;
	const badgeModules = Math.round(size * BADGE_SHARE[level]);
	return {
		svg: roundedQrSvg({ size, badgeModules, isDark: (row, col) => data[row * size + col] === 1 }),
		size,
		badgeModules,
	};
}

export interface PairingQr {
	readonly dataUrl: string;
	/** The badge's diameter as a share of the code's width: the cleared centre less a margin of white. */
	readonly badge: number;
}

export function pairingQr(text: string): PairingQr {
	const { svg, size, badgeModules } = pairingQrSvg(text);
	return {
		dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
		badge: (badgeModules - 1.5) / size,
	};
}

function inFinder(size: number, row: number, col: number): boolean {
	const top = row < FINDER;
	const left = col < FINDER;
	const right = col >= size - FINDER;
	const bottom = row >= size - FINDER;
	return (top && left) || (top && right) || (bottom && left);
}

/** Whether a module sits under the centre badge, which is drawn over the code instead. */
export function inBadge(size: number, badgeModules: number, row: number, col: number): boolean {
	const centre = size / 2;
	return Math.hypot(row + 0.5 - centre, col + 0.5 - centre) <= badgeModules / 2;
}

/** A rectangle path with each corner either square or rounded by `r`: top-left, top-right, bottom-right, bottom-left. */
function rectPath(x: number, y: number, w: number, h: number, r: number, round: readonly boolean[]): string {
	const [tl, tr, br, bl] = round.map((on) => (on ? r : 0));
	return [
		`M${x + tl} ${y}`,
		`H${x + w - tr}`,
		tr ? `A${tr} ${tr} 0 0 1 ${x + w} ${y + tr}` : "",
		`V${y + h - br}`,
		br ? `A${br} ${br} 0 0 1 ${x + w - br} ${y + h}` : "",
		`H${x + bl}`,
		bl ? `A${bl} ${bl} 0 0 1 ${x} ${y + h - bl}` : "",
		`V${y + tl}`,
		tl ? `A${tl} ${tl} 0 0 1 ${x + tl} ${y}` : "",
		"Z",
	].join("");
}

/** A rounded frame for one finder pattern: a 7×7 ring one module thick around a 3×3 core. */
function finderPath(x: number, y: number): string {
	const outer = rectPath(x, y, 7, 7, 2.2, [true, true, true, true]);
	// Wound the other way (counter-clockwise), so the non-zero fill cuts it out of the outer square.
	const inner = `M${x + 1 + 1.4} ${y + 1}A1.4 1.4 0 0 0 ${x + 1} ${y + 1 + 1.4}V${y + 6 - 1.4}A1.4 1.4 0 0 0 ${x + 1 + 1.4} ${y + 6}H${x + 6 - 1.4}A1.4 1.4 0 0 0 ${x + 6} ${y + 6 - 1.4}V${y + 1 + 1.4}A1.4 1.4 0 0 0 ${x + 6 - 1.4} ${y + 1}Z`;
	const core = rectPath(x + 2, y + 2, 3, 3, 1, [true, true, true, true]);
	return outer + inner + core;
}

export function roundedQrSvg(matrix: QrMatrix): string {
	const { size, badgeModules } = matrix;
	const dark = (row: number, col: number): boolean =>
		row >= 0 &&
		col >= 0 &&
		row < size &&
		col < size &&
		!inFinder(size, row, col) &&
		!inBadge(size, badgeModules, row, col) &&
		matrix.isDark(row, col);

	const parts: string[] = [finderPath(0, 0), finderPath(size - FINDER, 0), finderPath(0, size - FINDER)];
	for (let row = 0; row < size; row++) {
		for (let col = 0; col < size; col++) {
			if (!dark(row, col)) continue;
			const up = dark(row - 1, col);
			const down = dark(row + 1, col);
			const left = dark(row, col - 1);
			const right = dark(row, col + 1);
			// A corner stays square where it joins a neighbour, so runs of modules read as one shape;
			// joined sides overlap slightly so antialiasing leaves no seam between them.
			const w = right ? 1 + SEAM : 1;
			const h = down ? 1 + SEAM : 1;
			parts.push(rectPath(col, row, w, h, 0.5, [!up && !left, !up && !right, !down && !right, !down && !left]));
		}
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="geometricPrecision"><path fill="#000" d="${parts.join("")}"/></svg>`;
}
