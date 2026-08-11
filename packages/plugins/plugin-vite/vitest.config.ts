import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@vetta-org/plugin-sdk/manifest": fileURLToPath(
				new URL("../plugin-sdk/src/manifest.ts", import.meta.url),
			),
		},
	},
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
		testTimeout: 15_000,
	},
});
