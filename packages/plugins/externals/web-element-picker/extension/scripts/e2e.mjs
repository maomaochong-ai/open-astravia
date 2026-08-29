// 扩展端到端验证（Playwright + chromium-1194，加载真实 MV3 扩展）：
//   注入 / 挂载 / 事件回流 / 授权门控 / 激活 / 停止 / 导航恢复。
// 用法：bun extension/scripts/e2e.mjs（需先执行 build-extension.mjs）
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
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

// ── playwright-core 探测 ──
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

// ── 测试页 server ──

const html = `<!doctype html><html><head><meta charset="utf-8"><title>wep e2e</title></head>
<body><h1 id="heading">Hello</h1><button id="target">Target</button><a id="link" href="/page2">go</a></body></html>`;
const page2Html = `<!doctype html><html><head><meta charset="utf-8"></head><body><h2 id="second">Second</h2><span>content</span></body></html>`;

const server = createServer((req, res) => {
	res.setHeader("content-type", "text/html; charset=utf-8");
	res.end(req.url === "/page2" ? page2Html : html);
});
await new Promise((resolvePort) => server.listen(0, "127.0.0.1", resolvePort));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;

// ── 授权码（测试专用：用仓库私钥动态签名一张码，非硬编码完整码）──
// 依赖 .secrets/（由 license-keygen.mjs 一次性生成），缺失时给出友好提示。
const privateKeyPath = resolve(extRoot, ".secrets", "license-private.jwk.json");
if (!existsSync(privateKeyPath)) {
	console.error(`未找到私钥 ${privateKeyPath}，请先运行：bun extension/scripts/license-keygen.mjs`);
	process.exit(1);
}
const privateJwk = JSON.parse(readFileSync(privateKeyPath, "utf8"));
const signKey = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
	"sign",
]);
// 测试订单号仅用于 E2E 断言（order 必须与断言一致），非真实订单、非密钥。
const testPayload = encodePayload("E2E-TEST-0001", "20291231");
const testSig = new Uint8Array(
	await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signKey, new TextEncoder().encode(testPayload)),
);
const testCode = encodeLicense(testPayload, testSig);

// ── 启动带扩展的浏览器 ──
const userDataDir = resolve(extRoot, ".e2e-profile");
// 清掉历史 profile：残留的 wepLicense / wepSelecting 会破坏门控与导航恢复断言
rmSync(userDataDir, { recursive: true, force: true });
const context = await chromium.launchPersistentContext(userDataDir, {
	headless: true,
	executablePath: chromiumExec,
	args: [`--disable-extensions-except=${extDist}`, `--load-extension=${extDist}`],
});
const page = await context.newPage();
await page.goto(`${baseUrl}/`);

// 提取扩展 ID（等待 service worker 注册）
let extId = "";
for (let i = 0; i < 40 && !extId; i++) {
	for (const worker of context.serviceWorkers()) {
		const match = worker.url().match(/^chrome-extension:\/\/([^/]+)\//);
		if (match) extId = match[1];
	}
	if (!extId) await new Promise((r) => setTimeout(r, 250));
}
assert.ok(extId, "应能提取扩展 ID（background service worker）");
console.log(`[e2e] 扩展已加载，ID=${extId}`);

// ── 1. content script 注入 + 内核就位 ──
await page.waitForFunction(
	() => (document.documentElement?.hasAttribute("data-wep-injected") ?? false) && typeof window.__WEP__ === "object",
	undefined,
	{ timeout: 8000 },
);
console.log("1. 注入通过：data-wep-injected + window.__WEP__ 就位");

// ── 2. 未激活门控：wep-start 应被 background 拒绝 ──
const popup = await context.newPage();
await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
await popup.waitForSelector("#license-view:not([hidden])", { timeout: 8000 });
const denied = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "wep-start" }));
assert.deepEqual(denied, { ok: false, reason: "license-required" });
assert.strictEqual(await page.locator("#wep-root").count(), 0, "未激活时页面不应出现内核 UI");
console.log("2. 未激活门控通过：wep-start 被拒 + 无内核 UI");

// ── 3. 激活（UI 流程：填码 → 激活按钮）──
await popup.fill("#license-input", testCode);
await popup.click("#activate-btn");
await popup.waitForSelector("#control-view:not([hidden])", { timeout: 8000 });
const stored = await popup.evaluate(() => chrome.storage.sync.get("wepLicense"));
assert.ok(stored.wepLicense && stored.wepLicense.order === "E2E-TEST-0001", "激活后应写入 wepLicense");
console.log("3. 激活通过：授权码验签 + storage 写入");

// ── 4. 激活后开始选择 → 主世界挂载（先把目标页置为 active tab）──
	await page.bringToFront();
	await page.waitForTimeout(300);
	await popup.click("#toggle-btn");
	await page.waitForSelector("#wep-root", { timeout: 8000 });
console.log("4. 挂载通过：#wep-root 出现");

// ── 5. 点击元素 → selection-changed → 状态回流 ──
await page.click("#target");
await page.waitForTimeout(400);
const state1 = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "get-state" }));
assert.ok(state1.active, "选择态应为 active");
assert.ok((state1.count ?? 0) >= 1, `计数应 >=1，实际 ${state1.count}`);
console.log(`5. 事件回流通过：active=true, count=${state1.count}`);

// ── 6. 写轮眼设置切换 → storage + applySettings ──
await popup.click(".switch");
await page.waitForTimeout(300);
const settings = await popup.evaluate(() => chrome.storage.sync.get("wepSettings"));
assert.strictEqual(settings.wepSettings?.sharingan, true, "写轮眼开关应写入 storage");
console.log("6. 设置通过：写轮眼切换写入 storage");

// ── 7. 停止 → 内核销毁 ──
await popup.click("#toggle-btn");
await page.waitForSelector("#wep-root", { state: "detached", timeout: 8000 });
const state2 = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "get-state" }));
assert.strictEqual(state2.active, false, "停止后 active 应为 false");
console.log("7. 停止通过：内核销毁 + 状态复位");

// ── 8. 导航恢复：选择中导航到第二页 → 自动重挂载 ──
await popup.click("#toggle-btn");
await page.waitForSelector("#wep-root", { timeout: 8000 });
	await page.goto(`${baseUrl}/page2`);
	// 选择态下内核会拦截所有页面点击（含 <a>），导航恢复只能用程序化导航触发
	await page.waitForSelector("#wep-root", { timeout: 8000 });
console.log("8. 导航恢复通过：页面导航后自动重挂载");

await popup.evaluate(() => chrome.runtime.sendMessage({ type: "wep-stop" }));
await page.waitForTimeout(300);
assert.strictEqual(await page.locator("#wep-root").count(), 0);

console.log("\n[e2e] 扩展端到端验证全部通过（扩展 ID: " + extId + "）");
await context.close();
await new Promise((resolveClose) => server.close(resolveClose));
process.exit(0);
