// 生成品牌应用图标：build/icon.png / icon-dock.png / icon.icns / icon.ico
//
// 思路：读 astravia-brand-icon.svg → rsvg-convert 渲染 1024 PNG（homebrew librsvg，
// 对渐变/滤镜支持完整）→ sips 缩放各尺寸 → iconutil 组装 .icns → 内联 Node
// 组装 PNG-in-ICO（.ico）。
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const projectRoot = join(import.meta.dirname, "..");
const buildDir = join(projectRoot, "build");
const svgPath = join(import.meta.dirname, "astravia-brand-icon.svg");
const rsvgConvert = "/opt/homebrew/bin/rsvg-convert";

if (process.platform !== "darwin") {
	throw new Error(`generate-app-icon: requires darwin host (current: ${process.platform})`);
}

const stageDir = join(tmpdir(), "astravia-brand-icon");
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
mkdirSync(buildDir, { recursive: true });

// 1. SVG -> 1024x1024 PNG
console.log("[generate-app-icon] rsvg-convert -> 1024 PNG");
const basePng = join(stageDir, "icon-1024.png");
execFileSync(rsvgConvert, ["-w", "1024", "-h", "1024", svgPath, "-o", basePng], { stdio: "ignore" });

// 2. 各尺寸 PNG（iconset + ico 素材）
function resize(input, output, size) {
	execFileSync("/usr/bin/sips", ["-z", String(size), String(size), input, "--out", output], { stdio: "ignore" });
}
const iconSetDir = join(stageDir, "icon.iconset");
mkdirSync(iconSetDir, { recursive: true });
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
const pngBySize = new Map();
for (const size of sizes) {
	const p = join(stageDir, `icon-${size}.png`);
	resize(basePng, p, size);
	pngBySize.set(size, p);
}
for (const size of [16, 32, 128, 256, 512]) {
	const file = join(iconSetDir, `icon_${size}x${size}.png`);
	const file2x = join(iconSetDir, `icon_${size}x${size}@2x.png`);
	resize(basePng, file, size);
	resize(basePng, file2x, size * 2);
}
writeFileSync(join(iconSetDir, "icon_16x16.png"), readFileSync(pngBySize.get(16)));
writeFileSync(join(iconSetDir, "icon_16x16@2x.png"), readFileSync(pngBySize.get(32)));
writeFileSync(join(iconSetDir, "icon_32x32.png"), readFileSync(pngBySize.get(32)));
writeFileSync(join(iconSetDir, "icon_32x32@2x.png"), readFileSync(pngBySize.get(64)));
writeFileSync(join(iconSetDir, "icon_128x128.png"), readFileSync(pngBySize.get(128)));
writeFileSync(join(iconSetDir, "icon_128x128@2x.png"), readFileSync(pngBySize.get(256)));
writeFileSync(join(iconSetDir, "icon_256x256.png"), readFileSync(pngBySize.get(256)));
writeFileSync(join(iconSetDir, "icon_256x256@2x.png"), readFileSync(pngBySize.get(512)));
writeFileSync(join(iconSetDir, "icon_512x512.png"), readFileSync(pngBySize.get(512)));
writeFileSync(join(iconSetDir, "icon_512x512@2x.png"), readFileSync(pngBySize.get(1024)));

// 3. icns
console.log("[generate-app-icon] iconutil -> icon.icns");
execFileSync("/usr/bin/iconutil", ["-c", "icns", iconSetDir, "-o", join(buildDir, "icon.icns")], { stdio: "ignore" });

// 4. icon.png (512) / icon-dock.png (256)
writeFileSync(join(buildDir, "icon.png"), readFileSync(pngBySize.get(512)));
writeFileSync(join(buildDir, "icon-dock.png"), readFileSync(pngBySize.get(256)));

// 5. ICO（PNG-in-ICO，Vista+ 支持）：16/32/48/256 四个条目
function buildIco(sizesList) {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0); // reserved
	header.writeUInt16LE(1, 2); // type: icon
	header.writeUInt16LE(sizesList.length, 4); // count
	let offset = 6 + 16 * sizesList.length;
	const entries = [];
	const datas = [];
	for (const size of sizesList) {
		const png = readFileSync(pngBySize.get(size));
		const entry = Buffer.alloc(16);
		entry.writeUInt8(size === 256 ? 0 : size, 0); // width (0 = 256)
		entry.writeUInt8(size === 256 ? 0 : size, 1); // height
		entry.writeUInt8(0, 2); // color count
		entry.writeUInt8(0, 3); // reserved
		entry.writeUInt16LE(1, 4); // planes
		entry.writeUInt16LE(32, 6); // bit count
		entry.writeUInt32LE(png.length, 8); // bytes in res
		entry.writeUInt32LE(offset, 12); // image offset
		offset += png.length;
		entries.push(entry);
		datas.push(png);
	}
	return Buffer.concat([header, ...entries, ...datas]);
}
writeFileSync(join(buildDir, "icon.ico"), buildIco([256, 48, 32, 16]));

console.log(`[generate-app-icon] wrote icon.png / icon-dock.png / icon.icns / icon.ico in ${buildDir}`);
