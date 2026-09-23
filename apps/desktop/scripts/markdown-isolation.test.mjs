import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(desktop, "package.json"));
const directory = await mkdtemp(join(tmpdir(), "vetta-markdown-isolation-"));
try {
	await build({
		configFile: false, root: desktop, logLevel: "error",
		build: {
			target: "node22", outDir: directory, emptyOutDir: false,
			lib: { entry: join(desktop, "scripts/markdown-isolation.fixture.ts"), formats: ["es"], fileName: () => "main.mjs" },
			rollupOptions: { external: [/^node:/, "electron"] },
		},
	});
	const code = await new Promise((resolve, reject) => {
		const env = { ...process.env, MARKDOWN_TEST_DATA: join(directory, "data") };
		delete env.ELECTRON_RUN_AS_NODE;
		delete env.NODE_OPTIONS;
		const child = spawn(require("electron"), [join(directory, "main.mjs")], { env, stdio: "inherit", windowsHide: true });
		const watchdog = setTimeout(() => { child.kill(); reject(new Error("Isolation test timed out")); }, 60_000);
		child.once("error", reject);
		child.once("exit", (code) => { clearTimeout(watchdog); resolve(code); });
	});
	assert.equal(code, 0);
} finally {
	assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
	assert.ok(basename(directory).startsWith("vetta-markdown-isolation-"));
	await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
