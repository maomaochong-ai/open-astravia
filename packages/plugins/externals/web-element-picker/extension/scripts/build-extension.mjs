// 构建 MV3 扩展：内核 + 主世界桥拼接 kernel-inject.js，content/background/popup 打包，复制资源，打 zip。
// 用法：bun extension/scripts/build-extension.mjs [--dev]（--dev 关闭 minify，便于调试）
import { build } from "bun";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."); // extension/
const pluginRoot = resolve(root, "..");
const minify = !process.argv.includes("--dev");
const outdir = resolve(root, "dist");

// 1. 读取内核 IIFE 字符串（由 scripts/build-kernel.mjs 生成）
const generatedPath = resolve(pluginRoot, "src", "kernel", "kernel-bundle.generated.ts");
const generated = readFileSync(generatedPath, "utf8");
const match = generated.match(/export default ("(?:[^"\\]|\\.)*");/s);
if (!match) throw new Error("kernel-bundle.generated.ts 格式异常");
const kernelCode = JSON.parse(match[1]);

// 2. 构建主世界桥 → 拼接 kernel-inject.js
const injectOut = resolve(root, ".build");
rmSync(injectOut, { recursive: true, force: true });
mkdirSync(injectOut, { recursive: true });
await build({
	entrypoints: [resolve(root, "src", "inject-main.ts")],
	format: "iife",
	target: "browser",
	outdir: injectOut,
	minify,
});
const injectFile = (await import("node:fs")).readdirSync(injectOut).find((f) => f.endsWith(".js"));
if (!injectFile) throw new Error("inject-main 构建产物缺失");
const injectCode = readFileSync(resolve(injectOut, injectFile), "utf8");

mkdirSync(outdir, { recursive: true });
writeFileSync(resolve(outdir, "kernel-inject.js"), `${kernelCode}\n;\n${injectCode}\n`);
console.log(`[build-extension] kernel-inject.js = ${kernelCode.length + injectCode.length} bytes`);

// 3. content（iife）
await build({
	entrypoints: [resolve(root, "src", "content.ts")],
	format: "iife",
	target: "browser",
	outdir,
	minify,
	naming: { entry: "content.js" },
});
// background：产物自包含（无 import/export），用 iife 经典脚本，兼容 Firefox 等不支持 module service worker 的浏览器
await build({
	entrypoints: [resolve(root, "src", "background.ts")],
	format: "iife",
	target: "browser",
	outdir,
	minify,
	naming: { entry: "background.js" },
});
// popup（iife，<script> 标签加载，置于 popup/ 子目录）
rmSync(resolve(outdir, "popup"), { recursive: true, force: true });
mkdirSync(resolve(outdir, "popup"), { recursive: true });
await build({
	entrypoints: [resolve(root, "src", "popup", "popup.ts")],
	format: "iife",
	target: "browser",
	outdir: resolve(outdir, "popup"),
	minify,
	naming: { entry: "popup.js" },
});

// 4. 复制静态资源
cpSync(resolve(root, "manifest.json"), resolve(outdir, "manifest.json"));
cpSync(resolve(root, "assets"), resolve(outdir, "assets"), { recursive: true });
cpSync(resolve(root, "_locales"), resolve(outdir, "_locales"), { recursive: true });
cpSync(resolve(root, "src", "popup", "popup.html"), resolve(outdir, "popup", "popup.html"));
cpSync(resolve(root, "manifest.json"), resolve(outdir, "manifest.json"));
cpSync(resolve(root, "assets"), resolve(outdir, "assets"), { recursive: true });
cpSync(resolve(root, "_locales"), resolve(outdir, "_locales"), { recursive: true });

// 5. 打 zip（商店上架包）
const version = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8")).version;
const releaseDir = resolve(root, "release");
mkdirSync(releaseDir, { recursive: true });
const zipPath = resolve(releaseDir, `web-element-picker-extension-${version}.zip`);
rmSync(zipPath, { force: true });
execFileSync("zip", ["-rq", zipPath, "."], { cwd: outdir });
console.log(`[build-extension] ${zipPath} (${(await import("node:fs")).statSync(zipPath).size} bytes)`);

// 清理中间产物
rmSync(injectOut, { recursive: true, force: true });
console.log("[build-extension] done");
