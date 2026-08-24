import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	root: __dirname,
	resolve: {
		alias: {
			"@vetta/desktop-theme-ui/sidebar": resolve(
				__dirname,
				"../../../../apps/desktop/src/renderer/shared/theme/sdk/sidebar-primitives.ts",
			),
			"@vetta/theme-sdk/pages": resolve(__dirname, "../../../theme-sdk/src/pages/index.ts"),
		},
	},
	test: {
		environment: "jsdom",
		include: ["src/**/*.test.{ts,tsx}"],
	},
});
