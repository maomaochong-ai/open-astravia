// 把 src/kernel/kernel.ts 打成 iife 字符串，生成 src/kernel/kernel-bundle.generated.ts。
// 用法：bun scripts/build-kernel.mjs（在 vite build 之前执行）。
import { build } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(root, ".kernel-build");

const result = await build({
	entrypoints: [resolve(root, "src/kernel/kernel.ts")],
	format: "iife",
	target: "browser",
	outdir,
	minify: false,
});

const code = readFileSync(result.outputs[0].path, "utf8");
const generated = `// 由 scripts/build-kernel.mjs 生成，勿手改。\nexport default ${JSON.stringify(code)};\n`;
writeFileSync(resolve(root, "src/kernel/kernel-bundle.generated.ts"), generated);
console.log(`[build-kernel] bundled ${code.length} bytes -> src/kernel/kernel-bundle.generated.ts`);
