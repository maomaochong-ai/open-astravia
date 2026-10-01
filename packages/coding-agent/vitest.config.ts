import { fileURLToPath } from "node:url";
import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@astravia/coding-agent/resources": fileURLToPath(
				new URL("./src/public-api/resources.ts", import.meta.url),
			),
			"@astravia/agent-core": fileURLToPath(new URL("../agent/src/index.ts", import.meta.url)),
			"@astravia/ai": fileURLToPath(new URL("../ai/src/index.ts", import.meta.url)),
			"@astravia/ecosystem-adapter/hooks": fileURLToPath(
				new URL("../ecosystem-adapter/src/hooks/index.ts", import.meta.url),
			),
			"@astravia/ecosystem-adapter": fileURLToPath(new URL("../ecosystem-adapter/src/index.ts", import.meta.url)),
			"@astravia/runtime-knowledge": fileURLToPath(new URL("../runtime-knowledge/src/index.ts", import.meta.url)),
			"@astravia/runtime-subagents": fileURLToPath(new URL("../runtime-subagents/src/index.ts", import.meta.url)),
			"@astravia/runtime-storage/conversation": fileURLToPath(
				new URL("../runtime-storage/src/conversation/index.ts", import.meta.url),
			),
			"@astravia/runtime-node/sandbox": fileURLToPath(
				new URL("../runtime-node/src/sandbox/index.ts", import.meta.url),
			),
			"@astravia/runtime-node/conversation/legacy": fileURLToPath(
				new URL("../runtime-node/src/conversation/legacy.ts", import.meta.url),
			),
			"@astravia/runtime-node/conversation": fileURLToPath(
				new URL("../runtime-node/src/conversation/index.ts", import.meta.url),
			),
			"@astravia/runtime-node/coding": fileURLToPath(
				new URL("../runtime-node/src/coding/index.ts", import.meta.url),
			),
			"@astravia/runtime-node/host": fileURLToPath(new URL("../runtime-node/src/host/index.ts", import.meta.url)),
			"@astravia/runtime-node/mcp": fileURLToPath(new URL("../runtime-node/src/mcp/index.ts", import.meta.url)),
			"@astravia/runtime-tools/coding": fileURLToPath(
				new URL("../runtime-tools/src/coding/index.ts", import.meta.url),
			),
			"@astravia/runtime-tools": fileURLToPath(new URL("../runtime-tools/src/index.ts", import.meta.url)),
			"@astravia/runtime-mcp/auth": fileURLToPath(new URL("../runtime-mcp/src/auth/index.ts", import.meta.url)),
			"@astravia/runtime-mcp/client": fileURLToPath(
				new URL("../runtime-mcp/src/client/index.ts", import.meta.url),
			),
			"@astravia/runtime-mcp/config": fileURLToPath(
				new URL("../runtime-mcp/src/config/index.ts", import.meta.url),
			),
			"@astravia/runtime-mcp/protocol": fileURLToPath(
				new URL("../runtime-mcp/src/protocol/index.ts", import.meta.url),
			),
			"@astravia/runtime-mcp": fileURLToPath(new URL("../runtime-mcp/src/index.ts", import.meta.url)),
			"@astravia/runtime-core/configuration": fileURLToPath(
				new URL("../runtime-core/src/configuration/index.ts", import.meta.url),
			),
			"@astravia/runtime-core/observation": fileURLToPath(
				new URL("../runtime-core/src/observation/index.ts", import.meta.url),
			),
			"@astravia/runtime-core/kernel": fileURLToPath(
				new URL("../runtime-core/src/kernel/index.ts", import.meta.url),
			),
			"@astravia/runtime-core/conversation": fileURLToPath(
				new URL("../runtime-core/src/conversation/index.ts", import.meta.url),
			),
			"@astravia/runtime-core/failures": fileURLToPath(new URL("../runtime-core/src/failures.ts", import.meta.url)),
			"@astravia/runtime-core/sandbox": fileURLToPath(
				new URL("../runtime-core/src/sandbox/index.ts", import.meta.url),
			),
			"@astravia/runtime-core/session-extensions": fileURLToPath(
				new URL("../runtime-core/src/session-extensions/index.ts", import.meta.url),
			),
			"@astravia/runtime-core": fileURLToPath(new URL("../runtime-core/src/index.ts", import.meta.url)),
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
