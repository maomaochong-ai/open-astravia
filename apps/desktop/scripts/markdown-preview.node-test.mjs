import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build, transformWithEsbuild } from "vite";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const repoRequire = createRequire(join(repo, "package.json"));
const playwrightRequire = createRequire(repoRequire.resolve("@playwright/cli/package.json"));
const { chromium } = playwrightRequire("playwright");
const markdown = join(repo, "packages/theme-ui/src/markdown");

test(
	"real browser: isolated HTML interaction, blocked escape/network, inert SVG and bundled formula worker",
	{ timeout: 60_000 },
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "vetta-markdown-test-"));
		let browser;
		let server;
		try {
			await build({
				configFile: false,
				root: repo,
				logLevel: "error",
				build: {
					outDir: directory,
					emptyOutDir: false,
					lib: { entry: join(markdown, "math-client.ts"), formats: ["es"], fileName: "math-client" },
				},
				worker: { format: "es" },
			});
			const policyCode = await transformWithEsbuild(
				await readFile(join(markdown, "preview-policy.ts"), "utf8"),
				"preview-policy.ts",
				{ loader: "ts" },
			);
			const { createPreviewDocument, svgImageSource } = await import(
				`data:text/javascript;base64,${Buffer.from(policyCode.code).toString("base64")}`
			);
			server = createServer(async (request, response) => {
				if (request.url === "/") {
					response.end('<!doctype html><title>Isolated test</title><div id="host">Host</div>');
					return;
				}
				const path = resolve(directory, `.${new URL(request.url, "http://localhost").pathname}`);
				if (!path.startsWith(directory + sep)) {
					response.writeHead(403).end();
					return;
				}
				try {
					await stat(path);
					response.setHeader("Content-Type", "text/javascript");
					response.end(await readFile(path));
				} catch {
					response.writeHead(404).end();
				}
			});
			await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
			const port = server.address().port;
			browser = await chromium.launch({ headless: true, channel: process.env.VETTA_TEST_BROWSER || undefined });
			const page = await browser.newPage();
			page.setDefaultTimeout(5000);
			const external = [];
			await page.route("**/*", (route) => {
				if (new URL(route.request().url()).hostname === "127.0.0.1") return route.continue();
				external.push(route.request().url());
				return route.abort();
			});
			await page.goto(`http://127.0.0.1:${port}`);
			await page.evaluate(() => {
				window.vetta = { secret: "host-only" };
			});
			const source = `<h1>Page</h1><button onclick="this.textContent='Clicked'">Click</button><output id="result"></output><script>
		let blocked=false;try{parent.parent.document.getElementById('host').textContent='Escaped'}catch{blocked=true}
		document.querySelector('#result').textContent=blocked && !window.vetta ? 'Isolated' : 'Escaped';
		fetch('https://blocked.example/request').catch(()=>{});
		</script><img src="https://blocked.example/image"><iframe src="https://blocked.example/frame"></iframe>`;
			async function mount(scripts) {
				await page.evaluate(
					({ document, scripts }) => {
						document = String(document);
						window.document.querySelector("#preview")?.remove();
						const frame = window.document.createElement("iframe");
						frame.id = "preview";
						frame.sandbox = scripts ? "allow-scripts" : "";
						frame.srcdoc = document;
						window.document.body.append(frame);
					},
					{ document: createPreviewDocument(source, scripts), scripts },
				);
				return page.frameLocator("#preview").frameLocator("iframe").first();
			}
			let frame = await mount(false);
			await frame.locator("h1").waitFor({ state: "attached" });
			assert.equal(await frame.locator("#result").textContent(), "");
			frame = await mount(true);
			await frame.locator("#result").filter({ hasText: "Isolated" }).waitFor();
			await frame.locator("button").click();
			assert.equal(await frame.locator("button").textContent(), "Clicked");
			assert.equal(await page.locator("#host").textContent(), "Host");
			await frame.locator("html").evaluate(() => {
				location.href = "https://blocked.example/escape";
			});
			// A browser task after navigation processing; wait for a local result, not an arbitrary sleep.
			await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
			assert.doesNotMatch(await frame.locator("html").evaluate(() => location.href), /^https?:/);
			assert.deepEqual(external, []);
			const svg = svgImageSource(
				'<svg width="10" height="10"><script>parent.document.body.textContent="Escaped"</script><rect width="10" height="10" fill="green"/></svg>',
			);
			await page.evaluate(
				(src) =>
					new Promise((resolve, reject) => {
						const image = new Image();
						image.onload = resolve;
						image.onerror = reject;
						image.src = src;
						document.body.append(image);
					}),
				svg,
			);
			assert.equal(await page.locator("#host").textContent(), "Host");
			const html = await page.evaluate(async () => {
				const { requestFormula } = await import("/math-client.js");
				return new Promise((resolve) => requestFormula("\\frac{1}{2}", true, resolve));
			});
			assert.match(html, /<math/);
			assert.match(html, /mfrac/);
		} finally {
			await browser?.close();
			if (server) await new Promise((resolve) => server.close(resolve));
			// Only the exact mkdtemp result created above is removed.
			assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
			assert.ok(basename(directory).startsWith("vetta-markdown-test-"));
			await rm(directory, { recursive: true, force: true });
		}
	},
);
