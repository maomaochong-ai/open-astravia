import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@vetta-org/capability-sdk": fileURLToPath(new URL("../capability-sdk/src/index.ts", import.meta.url)),
		},
	},
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
	},
});
