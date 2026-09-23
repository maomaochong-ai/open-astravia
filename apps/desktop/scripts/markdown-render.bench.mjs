import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(desktop, "../..");
const localRequire = createRequire(join(desktop, "package.json"));
const repoRequire = createRequire(join(repo, "package.json"));
const playwrightRequire = createRequire(repoRequire.resolve("@playwright/cli/package.json"));
const { chromium } = playwrightRequire("playwright");
const directory = await mkdtemp(join(tmpdir(), "vetta-markdown-bench-"));
let browser;
let server;
try {
	await build({
		configFile: false, root: desktop, logLevel: "error",
		resolve: { alias: [{ find: "react-dom/client", replacement: localRequire.resolve("react-dom/profiling") }] },
		esbuild: { jsx: "automatic" },
		define: { "process.env.NODE_ENV": '"production"' },
		build: {
			outDir: directory, emptyOutDir: false,
			lib: { entry: join(desktop, "scripts/markdown-render.bench.tsx"), formats: ["es"], fileName: "benchmark" },
		},
		worker: { format: "es" },
	});
	server = createServer(async (request, response) => {
		if (request.url === "/") {
			response.end('<!doctype html><title>Markdown benchmark</title><style>body{width:800px;font:14px/1.6 sans-serif}pre{white-space:pre;overflow:auto}table{border-collapse:collapse}td,th{padding:4px}</style>');
			return;
		}
		const path = resolve(directory, `.${new URL(request.url, "http://localhost").pathname}`);
		if (!path.startsWith(directory + sep)) return response.writeHead(403).end();
		try {
			response.setHeader("Content-Type", extname(path) === ".css" ? "text/css" : "text/javascript");
			response.end(await readFile(path));
		} catch {
			response.writeHead(404).end();
		}
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	browser = await chromium.launch({ headless: true, channel: process.env.VETTA_TEST_BROWSER || undefined });
	const page = await browser.newPage();
	await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
	await page.goto(`http://127.0.0.1:${server.address().port}`);
	const results = await page.evaluate(async () => {
		const { runMarkdownBenchmark } = await import("/benchmark.js");
		return runMarkdownBenchmark();
	});
	const report = { browser: browser.version(), mode: "production-profiling", results };
	console.log(JSON.stringify(report, null, 2));
	if (process.argv[2]) await writeFile(resolve(process.argv[2]), `${JSON.stringify(report, null, 2)}\n`);
} finally {
	await browser?.close();
	if (server) await new Promise((resolve) => server.close(resolve));
	assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
	assert.ok(basename(directory).startsWith("vetta-markdown-bench-"));
	await rm(directory, { recursive: true, force: true });
}
