import { defineConfig } from "vitest/config";
import { AI_TEST_DEFAULTS } from "./vitest.suites.js";

export default defineConfig({
	test: {
		...AI_TEST_DEFAULTS,
		include: ["test/**/*.test.ts"],
	},
});
