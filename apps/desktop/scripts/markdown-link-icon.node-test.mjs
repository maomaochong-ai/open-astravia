import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "vite";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(desktop, "package.json"));
const playwrightRequire = createRequire(require.resolve("@playwright/cli/package.json"));
const { chromium } = playwrightRequire("playwright");

/**
 * 聊天里的网页链接徽标在 label 前放一个站点图标。真浏览器 + 真实 Tailwind 产物：
 * 取到 favicon 与退回通用地球图标这两种状态必须占同一个盒、并与 label 共享垂直中心。
 * jsdom 没有排版，这条只能落在浏览器里跑。
 */
test("resolved favicon and generic globe fallback share the label's vertical center", { timeout: 60_000 }, async () => {
	const directory = await mkdtemp(join(tmpdir(), "astravia-markdown-link-icon-"));
	let server;
	let browser;
	try {
		await build({
			configFile: false,
			root: desktop,
			logLevel: "error",
			define: { "process.env.NODE_ENV": '"production"' },
			plugins: [
				(await import(require.resolve("@tailwindcss/vite"))).default(),
				(await import(require.resolve("@vitejs/plugin-react"))).default(),
			],
			resolve: { alias: [{ find: "@renderer", replacement: join(desktop, "src/renderer") }] },
			build: {
				outDir: directory,
				emptyOutDir: false,
				lib: {
					entry: join(desktop, "scripts/markdown-link-icon.fixture.tsx"),
					formats: ["es"],
					fileName: "fixture",
				},
			},
		});

		server = createServer(async (request, response) => {
			const pathname = new URL(request.url, "http://localhost").pathname;
			if (pathname === "/") {
				response.setHeader("Content-Type", "text/html");
				response.end(
					'<!doctype html><html data-mode="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"></head><body><script type="module" src="/fixture.js"></script></body></html>',
				);
				return;
			}
			const path = resolve(directory, `.${pathname}`);
			if (!path.startsWith(directory + sep)) return response.writeHead(403).end();
			try {
				await stat(path);
				response.setHeader("Content-Type", extname(path) === ".css" ? "text/css" : "text/javascript");
				response.end(await readFile(path));
			} catch {
				response.writeHead(404).end();
			}
		});
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		browser = await chromium.launch({ headless: true, channel: process.env.ASTRAVIA_TEST_BROWSER || undefined });
		const page = await browser.newPage();
		await page.route("**/*", (route) =>
			new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
		);
		await page.goto(`http://127.0.0.1:${server.address().port}`);
		await page.waitForSelector("#no-icon a");

		const rows = await page.evaluate(() =>
			["has-icon", "no-icon"].flatMap((section) =>
				[...document.querySelectorAll(`#${section} a`)].map((link) => {
					const box = (element) => {
						const rect = element.getBoundingClientRect();
						return { top: rect.top, height: rect.height, center: rect.top + rect.height / 2 };
					};
					const icon = link.querySelector("span[aria-hidden]");
					return {
						section,
						label: link.querySelector("span.truncate").textContent,
						hasFavicon: icon.querySelector("img") !== null,
						icon: box(icon),
						labelBox: box(link.querySelector("span.truncate")),
						badge: box(link),
					};
				}),
			),
		);

		assert.equal(rows.length, 4, "两种图标状态都要渲染两条链接");
		assert.deepEqual(
			rows.map(({ section, hasFavicon }) => [section, hasFavicon]),
			[
				["has-icon", true],
				["has-icon", true],
				["no-icon", false],
				["no-icon", false],
			],
			"退回通用图标的那一行不应该渲染站点图标图片",
		);
		for (const row of rows) {
			const where = `${row.section} "${row.label}"`;
			const drift = Math.abs(row.icon.center - row.labelBox.center);
			assert.ok(
				drift <= 1,
				`${where}: 图标中心与文字中心相差 ${drift.toFixed(2)}px（图标 ${row.icon.top.toFixed(2)}+${row.icon.height}，文字 ${row.labelBox.top.toFixed(2)}+${row.labelBox.height}）`,
			);
			assert.equal(row.icon.height, 14, `${where}: 图标保持徽标的 14px 尺寸`);
			assert.ok(
				row.icon.top >= row.badge.top && row.icon.top + row.icon.height <= row.badge.top + row.badge.height,
				`${where}: 图标不应溢出徽标`,
			);
		}
	} finally {
		await browser?.close();
		if (server) await new Promise((resolve) => server.close(resolve));
		assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
		assert.ok(basename(directory).startsWith("astravia-markdown-link-icon-"));
		await rm(directory, { recursive: true, force: true });
	}
});
