import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

// Resolve dependency package locations without depending on workspace
// hoisting layout. createRequire works regardless of bun's .bun store
// symlink layout because we resolve through `import.meta.url`. Newer
// packages restrict their `exports` map and reject `<pkg>/package.json`
// style lookups, so we resolve a known entry and back out to the package
// root instead.
const require = createRequire(import.meta.url);
const ortEntryPath = require.resolve("onnxruntime-web");
const ortDistDir = dirname(ortEntryPath);

const pdfjsEntryPath = require.resolve("pdfjs-dist");
const pdfjsBuildDir = resolve(dirname(pdfjsEntryPath), "../build");

const ocrModelsDir = resolve(process.cwd(), "resources/ocr-models");
const outDir = resolve(process.cwd(), "dist/ocr-runner");
const requiredOrtFiles = new Set(["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]);

// The OCR runner is a standalone hidden-window page loaded via file:// in
// CLI mode. Three sets of files must be reachable as stable relative URLs:
//   - onnxruntime-web wasm/mjs   -> ./ort/
//   - pdfjs-dist worker          -> ./pdf/pdf.worker.min.mjs
//   - PP-OCRv5 models + dict     -> ./ocr-models/
// We hand-roll a tiny copy plugin (instead of vite-plugin-static-copy)
// because the latter preserves absolute source paths under `dest/` when
// given absolute src globs, which scatters files into deep directories.
function copyOcrRunnerAssets(): Plugin {
	return {
		name: "vetta-ocr-runner-copy-assets",
		apply: "build",
		generateBundle(_options, bundle) {
			for (const [fileName, item] of Object.entries(bundle)) {
				if (
					item.type === "asset" &&
					fileName.startsWith("assets/ort-wasm-") &&
					fileName.endsWith(".wasm")
				) {
					delete bundle[fileName];
				}
			}
		},
		writeBundle() {
			const ortOut = join(outDir, "ort");
			mkdirSync(ortOut, { recursive: true });
			const copiedOrtFiles = new Set<string>();
			for (const f of readdirSync(ortDistDir)) {
				if (requiredOrtFiles.has(f)) {
					cpSync(join(ortDistDir, f), join(ortOut, f));
					copiedOrtFiles.add(f);
				}
			}
			for (const f of requiredOrtFiles) {
				if (!copiedOrtFiles.has(f)) {
					throw new Error(`OCR runner missing required onnxruntime-web asset: ${f}`);
				}
			}

			const pdfOut = join(outDir, "pdf");
			mkdirSync(pdfOut, { recursive: true });
			cpSync(join(pdfjsBuildDir, "pdf.worker.min.mjs"), join(pdfOut, "pdf.worker.min.mjs"));

			const modelsOut = join(outDir, "ocr-models");
			mkdirSync(modelsOut, { recursive: true });
			for (const f of readdirSync(ocrModelsDir)) {
				cpSync(join(ocrModelsDir, f), join(modelsOut, f));
			}
		},
	};
}

export default defineConfig({
	root: "src/renderer-ocr",
	base: "./",
	plugins: [copyOcrRunnerAssets()],
	build: {
		outDir,
		emptyOutDir: true,
		assetsInlineLimit: 0,
		target: "esnext",
		rollupOptions: {
			input: resolve(process.cwd(), "src/renderer-ocr/index.html"),
		},
	},
	optimizeDeps: {
		exclude: ["onnxruntime-web"],
	},
});
