// 生成 DMG 背景图 build/background.png (660×440) 和 build/background@2x.png (1320×880)。
//
// 思路：写一段 SVG → qlmanage 渲染成 PNG → sips 裁剪/缩放，全部用 macOS 自带工具，
// 不引入 sharp/canvas 类原生依赖。仅在 macOS host 上有效（与 mac 打包前提一致）。
//
// qlmanage 渲染 SVG 时会强制输出正方形（-s N 给出 N×N），所以这里把 SVG 外框
// 设成 1320×1320、viewBox 设成 0 0 1320 880、preserveAspectRatio="xMidYMid meet"，
// 让 1320×880 的设计稿垂直居中渲染到 1320×1320 PNG（顶/底各 220px 留白），
// 再用 sips -c 880 1320 把中间 1320×880 内容带裁出来作为 @2x；最后 sips -z 缩到 @1x。

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
//
// --two-icons：签名+公证构建，DMG 不带「修复已损坏.app」，退回两图标常规版式。
const twoIcons = process.argv.includes("--two-icons");
const ICON_CENTERS_X_2X = twoIcons
	? [360, 960] // @1x: 180, 480
	: [200, 660, 1120]; // @1x: 100, 330, 560
const ICON_CENTER_Y_2X = 400; // @1x: 200

// 配色：warm off-white 背景 + 暖灰文字，贴合 Apple 自家 DMG 的极简调性。
const COLORS = {
	bg: "#fafaf9",
	text: "#292524",
	subtle: "#78716c",
	arrow: "#a8a29e",
};

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
<svg xmlns="http://www.w3.org/2000/svg" width="1320" height="1320" viewBox="0 0 1320 880" preserveAspectRatio="xMidYMid meet">
	<rect width="1320" height="880" fill="${COLORS.bg}"/>
	${arrows}
	<text x="660" y="700" font-family="-apple-system, Helvetica Neue, Helvetica" font-size="26" fill="${COLORS.text}" text-anchor="middle">
		拖动 Vetta 到 Applications 完成安装
	</text>
	${repairHint}
</svg>
`;

const stageDir = join(tmpdir(), "vetta-dmg-bg");
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
mkdirSync(buildDir, { recursive: true });

const svgPath = join(stageDir, "background.svg");
writeFileSync(svgPath, svg);

console.log("[generate-dmg-background] qlmanage -> square PNG");
execFileSync("/usr/bin/qlmanage", ["-t", "-s", "1320", "-o", stageDir, svgPath], { stdio: "ignore" });
const squarePng = join(stageDir, "background.svg.png");

const bg2xPath = join(buildDir, "background@2x.png");
const bgPath = join(buildDir, "background.png");

console.log("[generate-dmg-background] sips -c 880x1320 -> @2x");
// sips -c height width：从中心裁剪到指定尺寸；这里把 1320×1320 中间 880 行裁出来。
execFileSync("/usr/bin/sips", ["-c", "880", "1320", squarePng, "--out", bg2xPath], { stdio: "ignore" });

console.log("[generate-dmg-background] sips -z 440x660 -> @1x");
execFileSync("/usr/bin/sips", ["-z", "440", "660", bg2xPath, "--out", bgPath], { stdio: "ignore" });

console.log(`[generate-dmg-background] wrote ${bgPath} and ${bg2xPath}`);
