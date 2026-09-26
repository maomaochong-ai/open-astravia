// 程序化生成扩展图标（零依赖 PNG 编码器 + 256px 矢量感绘制 + 双线性缩放到 16/32/48/128）。
// 设计语言：与内核 design token 统一（--wep-accent #6366f1 → --wep-violet #8b5cf6 135° 对角渐变）。
// 用法：bun extension/scripts/generate-icon.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = resolve(root, "assets");
mkdirSync(assetsDir, { recursive: true });

// ─── 最小 PNG 编码器（RGBA8）───
const CRC_TABLE = new Int32Array(256).map((_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c;
});
function crc32(buf) {
	let c = 0xffffffff;
	for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, pixels) {
	const raw = Buffer.alloc(height * (1 + width * 4));
	for (let y = 0; y < height; y++) {
		raw[y * (1 + width * 4)] = 0; // filter none
		for (let x = 0; x < width; x++) {
			const [r, g, b, a] = pixels[y * width + x];
			const off = y * (1 + width * 4) + 1 + x * 4;
			raw[off] = r;
			raw[off + 1] = g;
			raw[off + 2] = b;
			raw[off + 3] = a;
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // RGBA
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

// ─── 256px 绘制 ───
const S = 256;
const px = new Array(S * S).fill(null).map(() => [0, 0, 0, 0]);

function blend(x, y, r, g, b, a) {
	if (x < 0 || y < 0 || x >= S || y >= S || a <= 0) return;
	const i = y * S + x;
	const p = px[i];
	const na = a / 255;
	const out = p[3] / 255;
	const mix = na + out * (1 - na);
	if (mix <= 0) return;
	p[0] = Math.round((r * na + p[0] * out * (1 - na)) / mix);
	p[1] = Math.round((g * na + p[1] * out * (1 - na)) / mix);
	p[2] = Math.round((b * na + p[2] * out * (1 - na)) / mix);
	p[3] = Math.round(mix * 255);
}

function cover(x0, y0, x1, y1, r, g, b, a) {
	for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
		for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
			blend(x, y, r, g, b, a);
		}
	}
}

function roundRect(x0, y0, x1, y1, radius, r, g, b, a) {
	const r2 = Math.max(radius, 0);
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) {
			let dx = 0;
			let dy = 0;
			if (x < x0 + r2) dx = x0 + r2 - x;
			else if (x > x1 - r2) dx = x - (x1 - r2);
			if (y < y0 + r2) dy = y0 + r2 - y;
			else if (y > y1 - r2) dy = y - (y1 - r2);
			const d = Math.sqrt(dx * dx + dy * dy);
			const aa = Math.max(0, Math.min(1, r2 - d + 0.5));
			blend(x, y, r, g, b, Math.round(a * aa));
		}
	}
}

function hline(y, x0, x1, r, g, b, a) {
	for (let x = x0; x <= x1; x++) blend(x, y, r, g, b, a);
}
function vline(x, y0, y1, r, g, b, a) {
	for (let y = y0; y <= y1; y++) blend(x, y, r, g, b, a);
}

// ── 内核设计 token 对齐 ──
// 135° 对角渐变：#6366f1 (indigo-500) → #8b5cf6 (violet-500)
// 从左上角 (0,0) 到右下角 (S-1, S-1)
const C1 = [99, 102, 241]; // #6366f1 (indigo-500, --wep-accent)
const C2 = [139, 92, 246]; // #8b5cf6 (violet-500, --wep-violet)
for (let y = 0; y < S; y++) {
	for (let x = 0; x < S; x++) {
		const t = (x + y) / (2 * (S - 1));
		const r = Math.round(C1[0] + (C2[0] - C1[0]) * t);
		const g = Math.round(C1[1] + (C2[1] - C1[1]) * t);
		const b = Math.round(C1[2] + (C2[2] - C1[2]) * t);
		blend(x, y, r, g, b, 255);
	}
}
// 裁成圆角（mask）：外圈透明度按距离场渐变
const MARGIN = 20;
const RADIUS = 64;
for (let y = 0; y < S; y++) {
	for (let x = 0; x < S; x++) {
		let dx = 0;
		let dy = 0;
		if (x < MARGIN + RADIUS) dx = MARGIN + RADIUS - x;
		else if (x > S - 1 - MARGIN - RADIUS) dx = x - (S - 1 - MARGIN - RADIUS);
		if (y < MARGIN + RADIUS) dy = MARGIN + RADIUS - y;
		else if (y > S - 1 - MARGIN - RADIUS) dy = y - (S - 1 - MARGIN - RADIUS);
		const d = Math.sqrt(dx * dx + dy * dy) - RADIUS;
		if (d > 0.5) {
			px[y * S + x] = [0, 0, 0, 0];
		} else if (d > -0.5) {
			const a = Math.round((0.5 - d) * 255);
			px[y * S + x][3] = Math.min(px[y * S + x][3], a);
		}
	}
}

// ── 四角准星（签名视觉：元素选择框角标，粗白线 L 型）──
const W = 14;
const L = 60;
const cxs = [36, S - 36 - L];
const cys = [44, S - 44 - L];
for (const cx of cxs) {
	for (const cy of cys) {
		cover(cx, cy, cx + L, cy + W, 255, 255, 255, 255);
		cover(cx, cy, cx + W, cy + L, 255, 255, 255, 255);
	}
}
// 准星内层（更亮的白色，形成双层效果）
const W2 = 8;
const L2 = 50;
const offset = 3;
for (const cx of cxs) {
	for (const cy of cys) {
		cover(cx + offset, cy + offset, cx + offset + L2, cy + offset + W2, 255, 255, 255, 230);
		cover(cx + offset, cy + offset, cx + offset + W2, cy + offset + L2, 255, 255, 255, 230);
	}
}

// ── 中央瞄准点（小十字线 + 圆环，强化"瞄准"语义）──
// 十字线
cover(124, 116, 132, 140, 255, 255, 255, 255); // 竖线
cover(116, 124, 140, 132, 255, 255, 255, 255); // 横线
// 中心圆点
roundRect(122, 122, 134, 134, 6, 255, 255, 255, 255);
roundRect(124, 124, 132, 132, 4, 99, 102, 241, 255); // 内核 accent 色填充

// ── 缩放 + 输出 ──
function sample(u, v) {
	const x = Math.min(S - 1, Math.max(0, Math.floor(u)));
	const y = Math.min(S - 1, Math.max(0, Math.floor(v)));
	return px[y * S + x];
}
function resize(size) {
	const out = new Array(size * size).fill(null).map(() => [0, 0, 0, 0]);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const sx = ((x + 0.5) / size) * S - 0.5;
			const sy = ((y + 0.5) / size) * S - 0.5;
			const x0 = Math.floor(sx);
			const y0 = Math.floor(sy);
			const fx = sx - x0;
			const fy = sy - y0;
			const p00 = sample(x0, y0);
			const p10 = sample(x0 + 1, y0);
			const p01 = sample(x0, y0 + 1);
			const p11 = sample(x0 + 1, y0 + 1);
			const outP = out[y * size + x];
			for (let c = 0; c < 4; c++) {
				const top = p00[c] * (1 - fx) + p10[c] * fx;
				const bot = p01[c] * (1 - fx) + p11[c] * fx;
				outP[c] = Math.round(top * (1 - fy) + bot * fy);
			}
		}
	}
	return out;
}

for (const size of [16, 32, 48, 128]) {
	const png = encodePng(size, size, resize(size));
	const path = resolve(assetsDir, `icon${size}.png`);
	writeFileSync(path, png);
	console.log(`[generate-icon] ${path} (${png.length} bytes)`);
}
console.log("[generate-icon] done");
