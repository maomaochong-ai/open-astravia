// 生成 DMG 背景图 build/background.png (660×440) 和 build/background@2x.png (1320×880)。
//
// 思路：写一段 SVG → rsvg-convert（homebrew librsvg）渲染成 1320×880 @2x PNG →
// sips 缩到 @1x。不引入 sharp/canvas 类原生依赖。仅在 darwin host 上有效
// （与 mac 打包前提一致）。
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const projectRoot = join(import.meta.dirname, "..");
const buildDir = join(projectRoot, "build");

if (process.platform !== "darwin") {
	throw new Error(`generate-dmg-background: requires darwin host (current: ${process.platform})`);
}

// 设计稿坐标系：@2x，1320×880。@1x DMG 窗口是 660×440。
// 图标位水平居中，间距相等。这里只画背景视觉指引；图标本身由 electron-builder
// 通过 dmg.contents 摆放到对应 (x, y) 上（坐标用 @1x），两处必须对齐。

// --two-icons：签名+公证构建，DMG 不带「修复已损坏.app」，退回两图标常规版式。
const twoIcons = process.argv.includes("--two-icons");
const ICON_CENTERS_X_2X = twoIcons
	? [360, 960] // @1x: 180, 480
	: [200, 660, 1120]; // @1x: 100, 330, 560
const ICON_CENTER_Y_2X = 400; // @1x: 200

// 配色：品牌色板（astravia-brand.vetd frames/palette）——象牙白底 + 暖墨文字 +
// 星轨 indigo 箭头，贴合 Apple 自家 DMG 极简调性。
const COLORS = {
	bg: "#fafaf9",
	text: "#292524",
	subtle: "#78716c",
	arrow: "#6366f1",
};

// 顶部品牌徽标：星轨（星环 + 行星 + 点缀星），与 scripts/astravia-brand-icon.svg
// 图形语言一致（宽环 + 金色行星 + 少量星点，safe-area 规范见 build/ICON-SPEC.md）。
const logoDefs = `
	<linearGradient id="logoGrad" x1="0" y1="0" x2="1" y2="1">
		<stop offset="0" stop-color="#4f46e5"/>
		<stop offset="0.55" stop-color="#8b5cf6"/>
		<stop offset="1" stop-color="#0b0d18"/>
	</linearGradient>
	<linearGradient id="logoPlanet" x1="0" y1="0" x2="1" y2="1">
		<stop offset="0" stop-color="#fbbf24"/>
		<stop offset="1" stop-color="#f59e0b"/>
	</linearGradient>
`;
const logo = `
	<g transform="translate(588 96)">
		<rect width="144" height="144" rx="34" fill="url(#logoGrad)"/>
		<ellipse cx="72" cy="72" rx="52" ry="24" fill="none" stroke="#dce0ea" stroke-opacity="0.85" stroke-width="14" transform="rotate(-24 72 72)"/>
		<circle cx="100" cy="48" r="14" fill="url(#logoPlanet)"/>
		<circle cx="42" cy="39" r="7" fill="#dce0ea" fill-opacity="0.85"/>
		<circle cx="107" cy="80" r="7" fill="#dce0ea" fill-opacity="0.5"/>
	</g>
`;

function arrow(fromX, toX) {
	const y = ICON_CENTER_Y_2X;
	const headSize = 14;
	const shaftEnd = toX - headSize;
	return `
		<line x1="${fromX}" y1="${y}" x2="${shaftEnd}" y2="${y}" stroke="${COLORS.arrow}" stroke-width="3" stroke-linecap="round"/>
		<polygon points="${toX},${y} ${shaftEnd},${y - headSize / 2} ${shaftEnd},${y + headSize / 2}" fill="${COLORS.arrow}"/>
	`;
}

const ARROW_GAP = 110; // 图标边到箭头端的间距（@2x）
const arrows = ICON_CENTERS_X_2X.slice(1)
	.map((center, index) => arrow(ICON_CENTERS_X_2X[index] + ARROW_GAP, center - ARROW_GAP))
	.join("");

// 「已损坏」提示只对未签名产物有意义。
const repairHint = twoIcons
	? ""
	: `<text x="660" y="744" font-family="-apple-system, Helvetica Neue, Helvetica" font-size="20" fill="${COLORS.subtle}" text-anchor="middle">
		若提示「已损坏」，请右键点击「修复已损坏」选「打开」
	</text>`;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1320" height="880" viewBox="0 0 1320 880">
	<defs>
	${logoDefs}
	</defs>
	<rect width="1320" height="880" fill="${COLORS.bg}"/>
	${logo}
	${arrows}
	<text x="660" y="700" font-family="-apple-system, Helvetica Neue, Helvetica" font-size="26" fill="${COLORS.text}" text-anchor="middle">
		拖动 Astravia 到 Applications 完成安装
	</text>
	${repairHint}
</svg>
`;

const stageDir = join(tmpdir(), "astravia-dmg-bg");
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
mkdirSync(buildDir, { recursive: true });

const svgPath = join(stageDir, "background.svg");
writeFileSync(svgPath, svg);

const bg2xPath = join(buildDir, "background@2x.png");
const bgPath = join(buildDir, "background.png");
console.log("[generate-dmg-background] rsvg-convert -> @2x");
execFileSync("/opt/homebrew/bin/rsvg-convert", ["-w", "1320", "-h", "880", svgPath, "-o", bg2xPath], { stdio: "ignore" });

console.log("[generate-dmg-background] sips -z 440x660 -> @1x");
execFileSync("/usr/bin/sips", ["-z", "440", "660", bg2xPath, "--out", bgPath], { stdio: "ignore" });

console.log(`[generate-dmg-background] wrote ${bgPath} and ${bg2xPath}`);
