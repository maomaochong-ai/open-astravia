import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@vetta/agent-core": fileURLToPath(new URL("../agent/src/index.ts", import.meta.url)),
			"@vetta/runtime-core/conversation": fileURLToPath(
				new URL("./src/conversation/index.ts", import.meta.url),
			),
			"@vetta/runtime-core/kernel": fileURLToPath(new URL("./src/kernel/index.ts", import.meta.url)),
			"@vetta/runtime-core/sandbox": fileURLToPath(new URL("./src/sandbox/index.ts", import.meta.url)),
			"@vetta/runtime-core": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
		},
	},
	test: {
		globals: true,
		environment: "node",
	},
});
