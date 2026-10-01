import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@astravia/agent-core": fileURLToPath(new URL("../agent/src/index.ts", import.meta.url)),
			"@astravia/ai": fileURLToPath(new URL("../ai/src/index.ts", import.meta.url)),
			"@astravia/runtime-core/conversation": fileURLToPath(
				new URL("./src/conversation/index.ts", import.meta.url),
			),
			"@astravia/runtime-core/kernel": fileURLToPath(new URL("./src/kernel/index.ts", import.meta.url)),
			"@astravia/runtime-core/sandbox": fileURLToPath(new URL("./src/sandbox/index.ts", import.meta.url)),
			"@astravia/runtime-core": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
		},
	},
	test: {
		globals: true,
		environment: "node",
	},
});
