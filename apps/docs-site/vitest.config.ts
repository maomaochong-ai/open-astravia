import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL(".", import.meta.url)),
			// fumadocs-core 的 i18n middleware 用裸的 "next/server" 引 next，而 next 没有
			// exports 字段，Node 原生 ESM 不会补扩展名。
			"next/server": "next/server.js",
		},
	},
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
		// 让 fumadocs-core 走 Vite 的解析流程，上面的 alias 才会作用于其内部导入。
		server: {
			deps: {
				inline: ["fumadocs-core"],
			},
		},
	},
});
