import { resolve } from "node:path";
import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": resolve(__dirname, "./src"),
			"@shared": resolve(__dirname, "./src/renderer/shared"),
			"@domains": resolve(__dirname, "./src/renderer/domains"),
		},
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		// Opt-in via `bun run test:coverage` only; default `test` is unchanged.
		// Full src denominator is intentional — low totals reflect thin unit coverage,
		// not a trimmed include list. UI still relies on verify:ui:*, not V8.
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "lcov"],
			reportsDirectory: "./coverage",
			reportOnFailure: true,
			// Honest full-src denominator; low totals reflect thin unit coverage.
			include: ["src/**/*.{ts,tsx}"],
			exclude: [...coverageConfigDefaults.exclude],
		},
	},
});
