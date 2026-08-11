import { defineConfig } from "vitest/config";
import { defaultTestOptions, resolveAliases } from "./vitest.suites.js";

export default defineConfig({
	resolve: {
		alias: resolveAliases,
	},
	test: {
		...defaultTestOptions,
		include: ["test/**/*.test.ts"],
	},
});
