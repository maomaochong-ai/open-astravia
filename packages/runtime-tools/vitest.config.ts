import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@vetta/agent-core": fileURLToPath(new URL("../agent/src/index.ts", import.meta.url)),
			"@vetta/runtime-knowledge": fileURLToPath(new URL("../runtime-knowledge/src/index.ts", import.meta.url)),
			"@vetta/runtime-core/kernel": fileURLToPath(
				new URL("../runtime-core/src/kernel/index.ts", import.meta.url),
			),
		},
	},
	test: {
		environment: "node",
		server: {
			deps: {
				external: ["glob", "ignore"],
			},
		},
	},
});
