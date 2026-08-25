import { resolve } from "node:path";
import { coverageConfigDefaults, defineConfig } from "vitest/config";

const codingAgentSrc = resolve(__dirname, "../../packages/coding-agent/src");

export default defineConfig({
	// Keep the package-local `src/**/*.test.*` include stable regardless of
	// whether Vitest is launched from this package or the monorepo root.
	root: __dirname,
	resolve: {
		alias: [
			{
				find: "@vetta/runtime-core/configuration",
				replacement: resolve(__dirname, "../../packages/runtime-core/src/configuration/index.ts"),
			},
			{
				find: "@vetta/runtime-core/observation",
				replacement: resolve(__dirname, "../../packages/runtime-core/src/observation/index.ts"),
			},
			{
				find: "@vetta/runtime-node/conversation/legacy",
				replacement: resolve(__dirname, "../../packages/runtime-node/src/conversation/legacy.ts"),
			},
			{ find: "@", replacement: resolve(__dirname, "./src") },
			{ find: "@shared", replacement: resolve(__dirname, "./src/renderer/shared") },
			{ find: "@domains", replacement: resolve(__dirname, "./src/renderer/domains") },
			{ find: "@cloud", replacement: resolve(__dirname, "./src/renderer/cloud") },
			{
				find: "@vetta-org/plugin-sdk/manifest",
				replacement: resolve(__dirname, "../../packages/plugins/plugin-sdk/src/manifest.ts"),
			},
			{
				find: "@vetta/ai/reasoning-presets",
				replacement: resolve(__dirname, "../../packages/ai/src/reasoning-presets.ts"),
			},
			{ find: "@vetta/ai/testing", replacement: resolve(__dirname, "../../packages/ai/src/testing/index.ts") },
			{ find: "@vetta/ai/protocol", replacement: resolve(__dirname, "../../packages/ai/src/protocol/index.ts") },
			{ find: "@vetta/ai", replacement: resolve(__dirname, "../../packages/ai/src/index.ts") },
			{ find: "@vetta/agent-core", replacement: resolve(__dirname, "../../packages/agent/src/index.ts") },
			{
				find: "@vetta/coding-agent/host",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/host/tool-environment/node/index.ts"),
			},
			{
				find: "@vetta/coding-agent/composition",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/composition/index.ts"),
			},
			{
				find: "@vetta/coding-agent/model-context",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/model-context.ts"),
			},
			{
				find: "@vetta/coding-agent/session-extensions",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/session-extensions.ts"),
			},
			{
				find: "@vetta/coding-agent/bootstrap",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/bootstrap.ts"),
			},
			{ find: "@vetta/coding-agent/config", replacement: resolve(__dirname, "../../packages/coding-agent/src/config.ts") },
			{
				find: "@vetta/coding-agent/extensions",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/extensions.ts"),
			},
			{
				find: "@vetta/coding-agent/host-services",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/host-services.ts"),
			},
			{
				find: "@vetta/coding-agent/hooks",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/hooks.ts"),
			},
			{
				find: "@vetta/coding-agent/historical-sessions",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/historical-sessions.ts"),
			},
			{
				find: "@vetta/coding-agent/profile",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/profile.ts"),
			},
			{
				find: "@vetta/coding-agent/cli-guidance",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/cli-guidance.ts"),
			},
			{
				find: "@vetta/coding-agent/resources",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/resources.ts"),
			},
			{
				find: "@vetta/coding-agent/rpc",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/rpc.ts"),
			},
			{
				find: "@vetta/coding-agent/runtime",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/runtime.ts"),
			},
			{
				find: "@vetta/coding-agent/settings",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/settings.ts"),
			},
			{ find: /^@vetta\/coding-agent\/(.+)\.js$/, replacement: `${codingAgentSrc}/$1.ts` },
			{ find: "@vetta/coding-agent", replacement: resolve(__dirname, "../../packages/coding-agent/src/index.ts") },
			{
				find: "@vetta/runtime-core/kernel",
				replacement: resolve(__dirname, "../../packages/runtime-core/src/kernel/index.ts"),
			},
			{
				find: "@vetta/runtime-core/conversation",
				replacement: resolve(__dirname, "../../packages/runtime-core/src/conversation/index.ts"),
			},
			{
				find: "@vetta/runtime-core/sandbox",
				replacement: resolve(__dirname, "../../packages/runtime-core/src/sandbox/index.ts"),
			},
			{
				find: "@vetta/runtime-core/session-extensions",
				replacement: resolve(__dirname, "../../packages/runtime-core/src/session-extensions/index.ts"),
			},
			{ find: "@vetta/runtime-core", replacement: resolve(__dirname, "../../packages/runtime-core/src/index.ts") },
			{ find: "@vetta/runtime-desktop", replacement: resolve(__dirname, "../../packages/runtime-desktop/src/index.ts") },
			{ find: "@vetta/runtime-mcp/auth", replacement: resolve(__dirname, "../../packages/runtime-mcp/src/auth/index.ts") },
			{ find: "@vetta/runtime-mcp/client", replacement: resolve(__dirname, "../../packages/runtime-mcp/src/client/index.ts") },
			{ find: "@vetta/runtime-mcp/config", replacement: resolve(__dirname, "../../packages/runtime-mcp/src/config/index.ts") },
			{
				find: "@vetta/runtime-mcp/protocol",
				replacement: resolve(__dirname, "../../packages/runtime-mcp/src/protocol/index.ts"),
			},
			{ find: "@vetta/runtime-mcp", replacement: resolve(__dirname, "../../packages/runtime-mcp/src/index.ts") },
			{
				find: "@vetta/runtime-knowledge",
				replacement: resolve(__dirname, "../../packages/runtime-knowledge/src/index.ts"),
			},
			{
				find: "@vetta/runtime-storage/conversation",
				replacement: resolve(__dirname, "../../packages/runtime-storage/src/conversation/index.ts"),
			},
			{
				find: "@vetta/runtime-node/conversation",
				replacement: resolve(__dirname, "../../packages/runtime-node/src/conversation/index.ts"),
			},
			{
				find: "@vetta/runtime-node/host",
				replacement: resolve(__dirname, "../../packages/runtime-node/src/host/index.ts"),
			},
			{
				find: "@vetta/runtime-node/sandbox",
				replacement: resolve(__dirname, "../../packages/runtime-node/src/sandbox/index.ts"),
			},
			{
				find: "@vetta/runtime-node/coding",
				replacement: resolve(__dirname, "../../packages/runtime-node/src/coding/index.ts"),
			},
			{
				find: "@vetta/runtime-node/mcp",
				replacement: resolve(__dirname, "../../packages/runtime-node/src/mcp/index.ts"),
			},
			{
				find: "@vetta/runtime-subagents",
				replacement: resolve(__dirname, "../../packages/runtime-subagents/src/index.ts"),
			},
			{
				find: "@vetta/remote-control",
				replacement: resolve(__dirname, "../../packages/remote-control/src/index.ts"),
			},
			{
				find: "@vetta/runtime-tools/coding",
				replacement: resolve(__dirname, "../../packages/runtime-tools/src/coding/index.ts"),
			},
			{
				find: "@vetta/runtime-tools",
				replacement: resolve(__dirname, "../../packages/runtime-tools/src/index.ts"),
			},
		],
	},
	test: {
		environment: "node",
		// .tsx 用于 renderer 组件测试；这类文件各自用 `@vitest-environment jsdom` docblock
		// 声明 DOM 环境，其余测试继续跑在 node 环境里。
		include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
		setupFiles: ["src/test/setup.ts"],
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
