import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "vite";

const require = createRequire(import.meta.url);
const playwrightRequire = createRequire(require.resolve("@playwright/cli/package.json"));
const { chromium } = playwrightRequire("playwright");

test("file selection and pointer prewarm share icons without mutating the application DOM", { timeout: 60_000 }, async () => {
	const result = await build({
		configFile: false,
		logLevel: "error",
		define: { "process.env.NODE_ENV": '"production"' },
		build: {
			write: false,
			lib: {
				entry: fileURLToPath(new URL("../src/renderer/domains/file-explorer/services/rasterize-app-file-icon.ts", import.meta.url)),
				formats: ["es"],
			},
		},
	});
	const code = result[0].output.find((item) => item.type === "chunk" && item.isEntry).code;
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.setContent(`<style>
			@layer utilities {
				.icon-\\[vscode-icons--file-type-typescript\\] {
					background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Cpath fill='red' d='M0 0h32v32H0z'/%3E%3C/svg%3E");
				}
			}
		</style><main><button>Open file</button><div contenteditable>Editor</div></main>`);
		const observation = await page.evaluate(async (code) => {
			const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
			const module = await import(url);
			URL.revokeObjectURL(url);
			let imageLoads = 0;
			const NativeImage = window.Image;
			window.Image = new Proxy(NativeImage, {
				construct(target, args) {
					imageLoads++;
					return Reflect.construct(target, args);
				},
			});
			const mutations = [];
			const observer = new MutationObserver((records) => mutations.push(...records));
			observer.observe(document.documentElement, { childList: true, subtree: true });
			const cached = [];
			const save = (path, png) => cached.push({ path, png });
			const a = { path: "/project/a.ts", name: "a.ts", isDirectory: false };
			const b = { path: "/project/b.ts", name: "b.ts", isDirectory: false };
			await Promise.all([
				module.cacheAppFileDragIcons([a], save),
				module.cacheAppFileDragIcons([a, b, b], save),
			]);
			await module.cacheAppFileDragIcons([b], save);
			observer.disconnect();
			window.Image = NativeImage;
			const decoded = new Image();
			decoded.src = cached[0]?.png ?? "";
			await decoded.decode();
			const canvas = document.createElement("canvas");
			canvas.width = canvas.height = 32;
			const context = canvas.getContext("2d");
			context.drawImage(decoded, 0, 0);
			return {
				mutations: mutations.length,
				cached,
				imageLoads,
				size: [decoded.width, decoded.height],
				pixel: [...context.getImageData(16, 16, 1, 1).data],
			};
		}, code);
		assert.equal(observation.mutations, 0, "warming a native drag icon must not invalidate the document style tree");
		assert.deepEqual(observation.cached.map(({ path }) => path).sort(), ["/project/a.ts", "/project/a.ts", "/project/b.ts", "/project/b.ts"]);
		assert.ok(observation.cached.every(({ png }) => png.startsWith("data:image/png;base64,")));
		assert.equal(new Set(observation.cached.map(({ png }) => png)).size, 1);
		assert.equal(observation.imageLoads, 1, "pointerdown and selection must share the in-flight conversion");
		assert.deepEqual(observation.size, [32, 32]);
		assert.deepEqual(observation.pixel, [255, 0, 0, 255], "native drag must keep the icon's image and color");

		const retries = await page.evaluate(async (code) => {
			const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
			const module = await import(url);
			URL.revokeObjectURL(url);
			const before = await module.rasterizeAppFileIconClass("late-icon");
			const sheet = document.styleSheets[0];
			sheet.insertRule('.late-icon { background-image: url("data:image/svg+xml,broken"); }', 0);
			const failed = await module.rasterizeAppFileIconClass("late-icon");
			sheet.deleteRule(0);
			sheet.insertRule(`@supports (display: grid) { @media all { .late-icon { --svg: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3C/svg%3E"); mask-image: var(--svg); } } }`, 0);
			const recovered = await module.rasterizeAppFileIconClass("late-icon", 16);
			const retried = await module.rasterizeAppFileIconClass("late-icon");
			return { before, failed, recovered, retried };
		}, code);
		assert.equal(retries.before, null);
		assert.equal(retries.failed, null);
		assert.ok(retries.recovered?.startsWith("data:image/png;base64,"));
		assert.ok(retries.retried?.startsWith("data:image/png;base64,"));
	} finally {
		await browser.close();
	}
});
