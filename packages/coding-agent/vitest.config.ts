import { fileURLToPath } from "node:url";
import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@vetta/coding-agent/resources": fileURLToPath(
				new URL("./src/public-api/resources.ts", import.meta.url),
			),
			"@vetta/agent-core": fileURLToPath(new URL("../agent/src/index.ts", import.meta.url)),
			"@vetta/ai": fileURLToPath(new URL("../ai/src/index.ts", import.meta.url)),
			"@vetta/ecosystem-adapter/hooks": fileURLToPath(
				new URL("../ecosystem-adapter/src/hooks/index.ts", import.meta.url),
			),
			"@vetta/ecosystem-adapter": fileURLToPath(new URL("../ecosystem-adapter/src/index.ts", import.meta.url)),
			"@vetta/runtime-knowledge": fileURLToPath(new URL("../runtime-knowledge/src/index.ts", import.meta.url)),
			"@vetta/runtime-subagents": fileURLToPath(new URL("../runtime-subagents/src/index.ts", import.meta.url)),
			"@vetta/runtime-storage/conversation": fileURLToPath(
				new URL("../runtime-storage/src/conversation/index.ts", import.meta.url),
			),
			"@vetta/runtime-node/sandbox": fileURLToPath(
				new URL("../runtime-node/src/sandbox/index.ts", import.meta.url),
			),
			"@vetta/runtime-node/conversation/legacy": fileURLToPath(
				new URL("../runtime-node/src/conversation/legacy.ts", import.meta.url),
			),
			"@vetta/runtime-node/conversation": fileURLToPath(
				new URL("../runtime-node/src/conversation/index.ts", import.meta.url),
			),
			"@vetta/runtime-node/coding": fileURLToPath(
				new URL("../runtime-node/src/coding/index.ts", import.meta.url),
			),
			"@vetta/runtime-node/host": fileURLToPath(new URL("../runtime-node/src/host/index.ts", import.meta.url)),
			"@vetta/runtime-node/mcp": fileURLToPath(new URL("../runtime-node/src/mcp/index.ts", import.meta.url)),
			"@vetta/runtime-tools/coding": fileURLToPath(
				new URL("../runtime-tools/src/coding/index.ts", import.meta.url),
			),
			"@vetta/runtime-tools": fileURLToPath(new URL("../runtime-tools/src/index.ts", import.meta.url)),
			"@vetta/runtime-mcp/auth": fileURLToPath(new URL("../runtime-mcp/src/auth/index.ts", import.meta.url)),
			"@vetta/runtime-mcp/client": fileURLToPath(
				new URL("../runtime-mcp/src/client/index.ts", import.meta.url),
			),
			"@vetta/runtime-mcp/config": fileURLToPath(
				new URL("../runtime-mcp/src/config/index.ts", import.meta.url),
			),
			"@vetta/runtime-mcp/protocol": fileURLToPath(
				new URL("../runtime-mcp/src/protocol/index.ts", import.meta.url),
			),
			"@vetta/runtime-mcp": fileURLToPath(new URL("../runtime-mcp/src/index.ts", import.meta.url)),
			"@vetta/runtime-core/configuration": fileURLToPath(
				new URL("../runtime-core/src/configuration/index.ts", import.meta.url),
			),
			"@vetta/runtime-core/observation": fileURLToPath(
				new URL("../runtime-core/src/observation/index.ts", import.meta.url),
			),
			"@vetta/runtime-core/kernel": fileURLToPath(
				new URL("../runtime-core/src/kernel/index.ts", import.meta.url),
			),
			"@vetta/runtime-core/conversation": fileURLToPath(
				new URL("../runtime-core/src/conversation/index.ts", import.meta.url),
			),
			"@vetta/runtime-core/failures": fileURLToPath(new URL("../runtime-core/src/failures.ts", import.meta.url)),
			"@vetta/runtime-core/sandbox": fileURLToPath(
				new URL("../runtime-core/src/sandbox/index.ts", import.meta.url),
			),
			"@vetta/runtime-core/session-extensions": fileURLToPath(
				new URL("../runtime-core/src/session-extensions/index.ts", import.meta.url),
			),
			"@vetta/runtime-core": fileURLToPath(new URL("../runtime-core/src/index.ts", import.meta.url)),
		},
	},
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000, // 30 seconds for API calls
		server: {
			deps: {
				external: [/@silvia-odwyer\/photon-node/],
			},
		},
		// Opt-in via `bun run test:coverage` only; default `test` is unchanged.
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "lcov"],
			reportsDirectory: "./coverage",
			// Known baseline failures must not hide the coverage map.
			reportOnFailure: true,
			// Honest denominator: package source. Untested files stay at 0% (Vitest 3 all:true).
			include: ["src/**/*.{ts,tsx}"],
			exclude: [
				...coverageConfigDefaults.exclude,
				// Third-party / static assets shipped with the package, not unit-test targets.
				"src/export-html/assets/vendor/**",
			],
		},
	},
});
