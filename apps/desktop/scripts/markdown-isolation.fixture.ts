import assert from "node:assert/strict";
import { app, BrowserWindow } from "electron";
import { HtmlPreviewService } from "../src/main/markdown/html-preview-service.js";
import { MermaidService } from "../src/main/markdown/mermaid-service.js";

console.log("isolation: boot");
app.setPath("userData", process.env.MARKDOWN_TEST_DATA ?? app.getPath("userData"));
app.disableHardwareAcceleration();
void app.whenReady().then(async () => {
console.log("isolation: ready");
const owner = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
await owner.loadURL("data:text/html,Host");
const html = new HtmlPreviewService(owner.webContents, "Markdown isolation test");
const diagrams = new MermaidService(owner.webContents);
try {
	console.log("isolation: html");
	const id = html.open('<button id="button" onclick="this.textContent=42">Run</button><!--\ud800-->');
	const preview = BrowserWindow.getAllWindows().find((window) => window !== owner);
	assert.ok(preview);
	if (preview.webContents.isLoading()) await new Promise<void>((resolve) => preview.webContents.once("did-finish-load", () => resolve()));
	assert.notEqual(preview.webContents.getOSProcessId(), owner.webContents.getOSProcessId());
	assert.equal(await preview.webContents.executeJavaScript("typeof require + ':' + typeof window.vetta"), "undefined:undefined");
	assert.equal(await preview.webContents.executeJavaScript("document.querySelector('button').click(); document.querySelector('button').textContent"), "42");
	assert.equal(await preview.webContents.executeJavaScript("window.open('https://example.com') === null"), true);
	assert.equal(await preview.webContents.executeJavaScript("fetch('https://example.com').then(()=>false,()=>true)"), true);
	html.close(id);
	assert.ok(preview.isDestroyed());
	console.log("isolation: diagrams");
	const svg = await diagrams.render("graph TD; A[Start]-->B[Finish]", "light");
	assert.match(svg, /<svg/);
	assert.match(svg, /Start/);
	assert.equal(await diagrams.render("graph TD; A[Start]-->B[Finish]", "light"), svg);
	await assert.rejects(diagrams.render("this is not a diagram", "light"));
	assert.match(await diagrams.render("sequenceDiagram\nAlice->>Bob: Hello", "dark"), /Hello/);
	// Start a synchronous infinite loop in a real renderer. Main must remain responsive and reap it.
	console.log("isolation: loop");
	html.open("<script>while(true){}</script>");
	const stuck = BrowserWindow.getAllWindows().find((window) => window !== owner);
	assert.ok(stuck);
	const killed = new Promise<void>((resolve) => stuck.once("closed", () => resolve()));
	assert.equal(await owner.webContents.executeJavaScript("21*2"), 42);
	await killed;
	assert.equal(await owner.webContents.executeJavaScript("6*7"), 42);
	assert.equal(BrowserWindow.getAllWindows().length, 1);
	console.log("PASS: independent PID, script execution, denied host/network/popups, Mermaid rendering/recovery/cache, infinite-loop watchdog, window cleanup");
} catch (error) {
	console.error(error);
	process.exitCode = 1;
} finally {
	diagrams.dispose(); html.dispose(); owner.destroy(); app.exit(Number(process.exitCode ?? 0));
}

}).catch((error: unknown) => { console.error(error); app.exit(1); });
