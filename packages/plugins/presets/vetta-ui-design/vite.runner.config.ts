import { builtinModules } from "node:module";
import { defineConfig } from "vite";

/**
 * 设计历史 runner 的独立构建（ADR-0069）：打成一个自包含 ESM 单文件，随插件
 * dist 分发，运行时物化到磁盘后由内置 node 执行。
 *
 * 与插件主构建分开的原因：主构建的产物是给浏览器的 Module Federation chunk，
 * 而这份产物要跑在 node 里、且必须把 isomorphic-git 一起打进去（物化出去的是
 * 一个孤立文件，旁边没有 node_modules）。
 */
export default defineConfig({
	build: {
		outDir: "history-runner/dist",
		emptyOutDir: true,
		target: "node20",
		minify: true,
		lib: {
			entry: "history-runner/src/runner-entry.ts",
			formats: ["es"],
			fileName: () => "runner.mjs",
		},
		rollupOptions: {
			external: [...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
		},
	},
});
