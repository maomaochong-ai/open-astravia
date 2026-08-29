// 商店截图脚本：产出 3 张提交物料（Chrome Web Store / Edge Add-ons 必填）：
//   01-activate.png   popup 激活表单（授权码输入界面）
//   02-selecting.png  选择器工作界面（悬停高亮 + 右下角状态胶囊）
//   03-result.png     选择结果（选中高亮 + 展开的命令面板：元素列表 / 快捷键 / 操作按钮）
// 用法：bun extension/scripts/store-screenshots.mjs（需先执行 build-extension.mjs）
// 输出：extension/release/screenshots/{01,02,03}-*.png（视口 1280x800，符合商店建议尺寸）
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeLicense, encodePayload } from "../src/license.ts";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const extRoot = resolve(scriptDir, "..");
const extDist = resolve(extRoot, "dist");
const repoRoot = resolve(extRoot, "../../../../..");

// 进度走 stderr：bun 对非 TTY stdout 块缓冲，重定向日志时 stdout 可能延迟落盘。
const log = (...args) => console.error(...args);

// ── playwright-core 探测（与 e2e.mjs 一致）──
const pwCandidates = [
	resolve(repoRoot, "node_modules/.bun/playwright-core@1.62.0-alpha-1783623505000/node_modules/playwright-core"),
	resolve(repoRoot, "node_modules/playwright-core"),
	resolve(repoRoot, "node_modules/playwright"),
];
const pwPath = pwCandidates.find((p) => existsSync(p));
if (!pwPath) {
	console.error("未找到 playwright-core（需要先 bun install 或还原 node_modules）");
	process.exit(1);
}
const { chromium } = require(pwPath);

// MV3 扩展需要完整 Chromium（headless_shell 不支持扩展）
const chromiumExec = [
	"/Users/zhugeyue/Library/Caches/ms-playwright/chromium-1194/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
].find((p) => existsSync(p));
if (!chromiumExec) {
	console.error("未找到 chromium-1194 可执行文件");
	process.exit(1);
}

// ── 演示页（简洁真实感的工具站布局，作为截图背景）──
const demoHtml = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><title>Astravia · 演示站</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font:14px/1.6 -apple-system,"PingFang SC","Segoe UI",system-ui,sans-serif; color:#1f2430; background:#f5f7fb; }
  nav { display:flex; align-items:center; gap:20px; padding:14px 32px; background:#fff; border-bottom:1px solid #e8ecf3; }
  .brand { font-weight:700; font-size:16px; color:#4f46e5; letter-spacing:.02em; }
  .brand span { color:#1f2430; }
  .menu { display:flex; gap:16px; color:#5b6472; font-size:13px; }
  .nav-btn { margin-left:auto; background:#4f46e5; color:#fff; border:none; border-radius:8px; padding:7px 16px; font:inherit; font-size:13px; cursor:pointer; }
  .hero { padding:44px 32px 36px; text-align:center; background:linear-gradient(180deg,#fff 0%,#f5f7fb 100%); }
  .hero h1 { font-size:28px; letter-spacing:-.01em; }
  .hero p { margin:10px auto 22px; max-width:520px; color:#5b6472; font-size:14px; }
  #cta { background:#4f46e5; color:#fff; border:none; border-radius:10px; padding:11px 26px; font-size:14px; font-weight:600; cursor:pointer; box-shadow:0 6px 18px rgba(79,70,229,.28); }
  .cards { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; padding:8px 32px 32px; }
  .card { background:#fff; border:1px solid #e8ecf3; border-radius:12px; padding:18px; cursor:pointer; }
  .card h3 { font-size:14px; margin-bottom:6px; }
  .card p { color:#6b7280; font-size:12.5px; }
  .card .tag { display:inline-block; margin-top:10px; font-size:11px; color:#4f46e5; background:#eef2ff; border-radius:999px; padding:2px 9px; }
</style>
</head>
<body>
  <nav>
    <div class="brand">Astravia<span> · 工作台</span></div>
    <div class="menu"><span>项目</span><span>文档</span><span>设置</span></div>
    <button class="nav-btn" id="nav-btn">新建项目</button>
  </nav>
  <header class="hero">
    <h1>把网页变成 AI 能读懂的上下文</h1>
    <p>点选任意元素，自动生成 CSS 选择器、XPath 与组件链，一键复制或发送给 AI 助手。</p>
    <button id="cta">立即体验</button>
  </header>
  <main class="cards">
    <div class="card" id="card-1"><h3>结构化上下文</h3><p>悬停预览、单击选中、Shift+单击多选，自动提取选择器与语义路径。</p><span class="tag">选择器 · XPath · 组件链</span></div>
    <div class="card" id="card-2"><h3>写轮眼复刻</h3><p>输出 DOM 结构、生效样式与状态的完整报告，供 AI 高保真复刻页面。</p><span class="tag">DOM · 样式 · 状态</span></div>
    <div class="card" id="card-3"><h3>一键交接</h3><p>复制提示词 / Markdown，或直接发送给 Astravia 对话，继续你的开发。</p><span class="tag">复制 · 发送 · 快捷操作</span></div>
  </main>
</body>
</html>`;

const server = createServer((req, res) => {
	res.setHeader("content-type", "text/html; charset=utf-8");
	res.end(demoHtml);
});
await new Promise((resolvePort) => server.listen(0, "127.0.0.1", resolvePort));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

// ── 测试授权码（同 e2e.mjs：用仓库私钥动态签发）──
const privateKeyPath = resolve(extRoot, ".secrets", "license-private.jwk.json");
if (!existsSync(privateKeyPath)) {
	log(`未找到私钥 ${privateKeyPath}，请先运行：bun extension/scripts/license-keygen.mjs`);
	process.exit(1);
}
const privateJwk = JSON.parse(readFileSync(privateKeyPath, "utf8"));
const signKey = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
	"sign",
]);
const shotPayload = encodePayload("SHOT-0001", "20291231");
const shotSig = new Uint8Array(
	await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signKey, new TextEncoder().encode(shotPayload)),
);
const shotCode = encodeLicense(shotPayload, shotSig);

// ── 启动带扩展的浏览器（zh-CN：扩展 i18n 走中文）──
const userDataDir = resolve(extRoot, ".screenshot-profile");
rmSync(userDataDir, { recursive: true, force: true });
const outDir = resolve(extRoot, "release", "screenshots");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const context = await chromium.launchPersistentContext(userDataDir, {
	headless: true,
	executablePath: chromiumExec,
	viewport: { width: 1280, height: 800 },
	args: [
		"--lang=zh-CN",
		`--disable-extensions-except=${extDist}`,
		`--load-extension=${extDist}`,
	],
});
const page = await context.newPage();
await page.goto(baseUrl);
await page.waitForTimeout(600);

// 提取扩展 ID（等待 service worker 注册）
let extId = "";
for (let i = 0; i < 40 && !extId; i++) {
	for (const worker of context.serviceWorkers()) {
		const match = worker.url().match(/^chrome-extension:\/\/([^/]+)\//);
		if (match) extId = match[1];
	}
	if (!extId) await new Promise((r) => setTimeout(r, 250));
}
if (!extId) {
	log("无法提取扩展 ID");
	process.exit(1);
}
log(`[shot] 扩展已加载 ID=${extId}`);

// ── 截图 1：popup 激活表单 ──
const popup = await context.newPage();
await popup.setViewportSize({ width: 320, height: 460 });
await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
await popup.waitForSelector("#license-view:not([hidden])", { timeout: 8000 });
await popup.waitForFunction(
	() => {
		const title = document.querySelector("#title");
		const btn = document.querySelector("#activate-btn");
		return title && btn && title.textContent && btn.textContent && btn.textContent.length > 0;
	},
	undefined,
	{ timeout: 8000 },
);
await popup.waitForTimeout(400);
await popup.screenshot({ path: resolve(outDir, "01-activate.png") });
log("[shot] 1/3 popup 激活表单 -> release/screenshots/01-activate.png");

// ── 激活 → 开始选择 ──
await popup.fill("#license-input", shotCode);
await popup.click("#activate-btn");
await popup.waitForSelector("#control-view:not([hidden])", { timeout: 8000 });
log("[shot] 已激活，开始选择");
await page.bringToFront();
await page.waitForTimeout(300);
await popup.click("#toggle-btn");
await page.waitForSelector("#wep-root", { timeout: 8000 });
await page.waitForTimeout(500);
log("[shot] 内核已挂载 (#wep-root)");

// ── 截图 2：悬停高亮（指针停在 CTA 上，高亮框保留）──
await page.hover("#cta");
await page.waitForSelector(".wep-hover", { timeout: 8000 });
await page.waitForTimeout(500);
await page.screenshot({ path: resolve(outDir, "02-selecting.png") });
log("[shot] 2/3 选择器工作界面（悬停高亮）-> release/screenshots/02-selecting.png");

// ── 选择 3 个元素（内核单击=单选替换，Shift+单击=追加）→ 展开命令面板 ──
await page.click("#card-1");
await page.waitForTimeout(250);
await page.click("#card-2", { modifiers: ["Shift"] });
await page.waitForTimeout(250);
await page.click("#cta", { modifiers: ["Shift"] });
await page.waitForFunction(() => document.querySelectorAll(".wep-selected").length >= 3, undefined, {
	timeout: 8000,
});
await page.waitForTimeout(400);
await page.click(".wep-cap");
await page.waitForSelector(".wep-panel.open", { timeout: 8000 });
await page.waitForTimeout(500);
await page.screenshot({ path: resolve(outDir, "03-result.png") });
log("[shot] 3/3 选择结果面板 -> release/screenshots/03-result.png");

await popup.evaluate(() => chrome.runtime.sendMessage({ type: "wep-stop" }));
await page.waitForTimeout(300);
await context.close();
await new Promise((resolveClose) => server.close(resolveClose));
rmSync(userDataDir, { recursive: true, force: true });
log("\n[shot] 完成：release/screenshots/ 下 3 张截图（1280x800 / 320x460）");
process.exit(0);
