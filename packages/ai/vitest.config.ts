import { defineConfig } from "vitest/config";
import { AI_INTEGRATION_TEST_FILES, AI_LIVE_TEST_FILES, AI_TEST_DEFAULTS } from "./vitest.suites.js";

export default defineConfig({
	test: {
		...AI_TEST_DEFAULTS,
		include: ["test/**/*.test.ts"],
		exclude: [...AI_INTEGRATION_TEST_FILES, ...AI_LIVE_TEST_FILES],
	},
});
