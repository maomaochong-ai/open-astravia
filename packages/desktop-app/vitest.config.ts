import { resolve } from "node:path";
import { coverageConfigDefaults, defineConfig } from "vitest/config";

const codingAgentSrc = resolve(__dirname, "../coding-agent/src");

export default defineConfig({
	resolve: {
		alias: [
			{ find: "@", replacement: resolve(__dirname, "./src") },
			{ find: "@shared", replacement: resolve(__dirname, "./src/renderer/shared") },
			{ find: "@domains", replacement: resolve(__dirname, "./src/renderer/domains") },
			{
				find: "@vetta-org/plugin-sdk/manifest",
				replacement: resolve(__dirname, "../plugins/plugin-sdk/src/manifest.ts"),
			},
			{ find: "@vetta/ai", replacement: resolve(__dirname, "../ai/src/index.ts") },
			{ find: "@vetta/agent-core", replacement: resolve(__dirname, "../agent/src/index.ts") },
			{
				find: "@vetta/coding-agent/host",
				replacement: resolve(__dirname, "../coding-agent/src/adapters/runtime-tools/index.ts"),
			},
			{
				find: "@vetta/coding-agent/composition",
				replacement: resolve(__dirname, "../coding-agent/src/composition/index.ts"),
			},
			{
				find: "@vetta/coding-agent/bootstrap",
				replacement: resolve(__dirname, "../coding-agent/src/public-api/bootstrap.ts"),
			},
			{ find: "@vetta/coding-agent/config", replacement: resolve(__dirname, "../coding-agent/src/config.ts") },
			{
				find: "@vetta/coding-agent/concurrency",
				replacement: resolve(__dirname, "../coding-agent/src/concurrency/index.ts"),
			},
			{
				find: "@vetta/coding-agent/extensions",
				replacement: resolve(__dirname, "../coding-agent/src/public-api/extensions.ts"),
			},
			{
				find: "@vetta/coding-agent/host-services",
				replacement: resolve(__dirname, "../coding-agent/src/public-api/host-services.ts"),
			},
			{
				find: "@vetta/coding-agent/historical-sessions",
				replacement: resolve(__dirname, "../coding-agent/src/public-api/historical-sessions.ts"),
			},
			{
				find: "@vetta/coding-agent/profile",
				replacement: resolve(__dirname, "../coding-agent/src/public-api/profile.ts"),
			},
			{
				find: "@vetta/coding-agent/product-prompt",
				replacement: resolve(__dirname, "../coding-agent/src/public-api/product-prompt.ts"),
			},
			{
				find: "@vetta/coding-agent/resources",
				replacement: resolve(__dirname, "../coding-agent/src/public-api/resources.ts"),
			},
			{
				find: "@vetta/coding-agent/rpc",
				replacement: resolve(__dirname, "../coding-agent/src/public-api/rpc.ts"),
			},
			{
				find: "@vetta/coding-agent/runtime",
				replacement: resolve(__dirname, "../coding-agent/src/public-api/runtime.ts"),
			},
			{ find: /^@vetta\/coding-agent\/(.+)\.js$/, replacement: `${codingAgentSrc}/$1.ts` },
			{ find: "@vetta/coding-agent", replacement: resolve(__dirname, "../coding-agent/src/index.ts") },
			{
				find: "@vetta/runtime-core/kernel",
				replacement: resolve(__dirname, "../runtime-core/src/kernel/index.ts"),
			},
			{
				find: "@vetta/runtime-core/conversation",
				replacement: resolve(__dirname, "../runtime-core/src/conversation/index.ts"),
			},
			{
				find: "@vetta/runtime-core/sandbox",
				replacement: resolve(__dirname, "../runtime-core/src/sandbox/index.ts"),
			},
			{ find: "@vetta/runtime-core", replacement: resolve(__dirname, "../runtime-core/src/index.ts") },
			{ find: "@vetta/runtime-mcp", replacement: resolve(__dirname, "../runtime-mcp/src/index.ts") },
			{
				find: "@vetta/runtime-knowledge",
				replacement: resolve(__dirname, "../runtime-knowledge/src/index.ts"),
			},
			{
				find: "@vetta/runtime-storage/conversation",
				replacement: resolve(__dirname, "../runtime-storage/src/conversation/index.ts"),
			},
			{
				find: "@vetta/runtime-subagents",
				replacement: resolve(__dirname, "../runtime-subagents/src/index.ts"),
			},
			{
				find: "@vetta/runtime-tools/coding",
				replacement: resolve(__dirname, "../runtime-tools/src/coding/index.ts"),
			},
		],
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
