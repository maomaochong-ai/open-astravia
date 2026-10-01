import { resolve } from "node:path";
import { coverageConfigDefaults, defineConfig } from "vitest/config";

const codingAgentSrc = resolve(__dirname, "../../packages/coding-agent/src");

export default defineConfig({
	// Keep the package-local `src/**/*.test.*` include stable regardless of
	// whether Vitest is launched from this package or the monorepo root.
	root: __dirname,
	resolve: {
		alias: [
			{ find: /^@astravia\/agent-team$/, replacement: resolve(__dirname, "../../packages/agent-team/src/index.ts") },
			{ find: "@astravia/runtime-telemetry/langfuse", replacement: resolve(__dirname, "../../packages/runtime-telemetry/src/langfuse.ts") },
			{ find: "@astravia/runtime-telemetry", replacement: resolve(__dirname, "../../packages/runtime-telemetry/src/index.ts") },
			{
				find: "@astravia/runtime-core/configuration",
				replacement: resolve(__dirname, "../../packages/runtime-core/src/configuration/index.ts"),
			},
			{
				find: "@astravia/runtime-core/observation",
				replacement: resolve(__dirname, "../../packages/runtime-core/src/observation/index.ts"),
			},
			{
				find: "@astravia/runtime-node/conversation/legacy",
				replacement: resolve(__dirname, "../../packages/runtime-node/src/conversation/legacy.ts"),
			},
			{ find: "@", replacement: resolve(__dirname, "./src") },
			{ find: "@shared", replacement: resolve(__dirname, "./src/renderer/shared") },
			{ find: "@domains", replacement: resolve(__dirname, "./src/renderer/domains") },
			{ find: "@cloud", replacement: resolve(__dirname, "./src/renderer/cloud") },
			{
				find: "@astravia-org/plugin-sdk/manifest",
				replacement: resolve(__dirname, "../../packages/plugins/plugin-sdk/src/manifest.ts"),
			},
			{
				find: "@astravia/ai/reasoning-presets",
				replacement: resolve(__dirname, "../../packages/ai/src/reasoning-presets.ts"),
			},
			{ find: "@astravia/ai/testing", replacement: resolve(__dirname, "../../packages/ai/src/testing/index.ts") },
			{ find: "@astravia/ai/protocol", replacement: resolve(__dirname, "../../packages/ai/src/protocol/index.ts") },
			{ find: "@astravia/ai/proxy", replacement: resolve(__dirname, "../../packages/ai/src/utils/proxy-config.ts") },
			{ find: "@astravia/ai", replacement: resolve(__dirname, "../../packages/ai/src/index.ts") },
			{ find: "@astravia/agent-core", replacement: resolve(__dirname, "../../packages/agent/src/index.ts") },
			{
				find: "@astravia/coding-agent/host",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/host/tool-environment/node/index.ts"),
			},
			{
				find: "@astravia/coding-agent/composition",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/composition/index.ts"),
			},
			{
				find: "@astravia/coding-agent/model-context",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/model-context.ts"),
			},
			{
				find: "@astravia/coding-agent/session-extensions",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/session-extensions.ts"),
			},
			{
				find: "@astravia/coding-agent/function-extensions",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/function-extensions.ts"),
			},
			{
				find: "@astravia/coding-agent/plugin-runtime",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/plugin-runtime.ts"),
			},
			{
				find: "@astravia/coding-agent/bootstrap",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/bootstrap.ts"),
			},
			{ find: "@astravia/coding-agent/config", replacement: resolve(__dirname, "../../packages/coding-agent/src/config.ts") },
			{
				find: "@astravia/coding-agent/extensions",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/extensions.ts"),
			},
			{
				find: "@astravia/coding-agent/host-services",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/host-services.ts"),
			},
			{
				find: "@astravia/coding-agent/hooks",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/hooks.ts"),
			},
			{
				find: "@astravia/coding-agent/historical-sessions",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/historical-sessions.ts"),
			},
			{
				find: "@astravia/coding-agent/profile",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/profile.ts"),
			},
			{
				find: "@astravia/coding-agent/cli-guidance",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/cli-guidance.ts"),
			},
			{
				find: "@astravia/coding-agent/resources",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/resources.ts"),
			},
			{
				find: "@astravia/coding-agent/rpc",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/rpc.ts"),
			},
			{
				find: "@astravia/coding-agent/runtime",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/runtime.ts"),
			},
			{
				find: "@astravia/coding-agent/settings",
				replacement: resolve(__dirname, "../../packages/coding-agent/src/public-api/settings.ts"),
			},
			{ find: /^@astravia\/coding-agent\/(.+)\.js$/, replacement: `${codingAgentSrc}/$1.ts` },
			{ find: "@astravia/coding-agent", replacement: resolve(__dirname, "../../packages/coding-agent/src/index.ts") },
			{
				find: "@astravia/runtime-core/kernel",
				replacement: resolve(__dirname, "../../packages/runtime-core/src/kernel/index.ts"),
			},
			{
				find: "@astravia/runtime-core/conversation",
				replacement: resolve(__dirname, "../../packages/runtime-core/src/conversation/index.ts"),
			},
			{
				find: "@astravia/runtime-core/failures",
				replacement: resolve(__dirname, "../../packages/runtime-core/src/failures.ts"),
			},
			{
				find: "@astravia/runtime-core/sandbox",
				replacement: resolve(__dirname, "../../packages/runtime-core/src/sandbox/index.ts"),
			},
			{
				find: "@astravia/runtime-core/session-extensions",
				replacement: resolve(__dirname, "../../packages/runtime-core/src/session-extensions/index.ts"),
			},
			{ find: "@astravia/runtime-core", replacement: resolve(__dirname, "../../packages/runtime-core/src/index.ts") },
			{ find: "@astravia/runtime-desktop", replacement: resolve(__dirname, "../../packages/runtime-desktop/src/index.ts") },
			{ find: "@astravia/runtime-mcp/auth", replacement: resolve(__dirname, "../../packages/runtime-mcp/src/auth/index.ts") },
			{
				find: "@astravia/runtime-mcp/browser",
				replacement: resolve(__dirname, "../../packages/runtime-mcp/src/browser/index.ts"),
			},
			{ find: "@astravia/runtime-mcp/client", replacement: resolve(__dirname, "../../packages/runtime-mcp/src/client/index.ts") },
			{ find: "@astravia/runtime-mcp/config", replacement: resolve(__dirname, "../../packages/runtime-mcp/src/config/index.ts") },
			{
				find: "@astravia/runtime-mcp/protocol",
				replacement: resolve(__dirname, "../../packages/runtime-mcp/src/protocol/index.ts"),
			},
			{ find: "@astravia/runtime-mcp", replacement: resolve(__dirname, "../../packages/runtime-mcp/src/index.ts") },
			{
				find: "@astravia/runtime-knowledge",
				replacement: resolve(__dirname, "../../packages/runtime-knowledge/src/index.ts"),
			},
			{
				find: "@astravia/runtime-storage/conversation",
				replacement: resolve(__dirname, "../../packages/runtime-storage/src/conversation/index.ts"),
			},
			{
				find: "@astravia/runtime-node/conversation",
				replacement: resolve(__dirname, "../../packages/runtime-node/src/conversation/index.ts"),
			},
			{
				find: "@astravia/runtime-node/host",
				replacement: resolve(__dirname, "../../packages/runtime-node/src/host/index.ts"),
			},
			{
				find: "@astravia/runtime-node/sandbox",
				replacement: resolve(__dirname, "../../packages/runtime-node/src/sandbox/index.ts"),
			},
			{
				find: "@astravia/runtime-node/coding",
				replacement: resolve(__dirname, "../../packages/runtime-node/src/coding/index.ts"),
			},
			{
				find: "@astravia/runtime-node/mcp",
				replacement: resolve(__dirname, "../../packages/runtime-node/src/mcp/index.ts"),
			},
			{
				find: "@astravia/runtime-subagents",
				replacement: resolve(__dirname, "../../packages/runtime-subagents/src/index.ts"),
			},
			{
				find: "@astravia/remote-control",
				replacement: resolve(__dirname, "../../packages/remote-control/src/index.ts"),
			},
			{
				find: "@astravia/runtime-tools/coding",
				replacement: resolve(__dirname, "../../packages/runtime-tools/src/coding/index.ts"),
			},
			{
				find: "@astravia/runtime-tools",
				replacement: resolve(__dirname, "../../packages/runtime-tools/src/index.ts"),
			},
		],
	},
	test: {
		environment: "node",
		// Git Bash loopback tests launch real processes. Keep hosted Windows runners
		// below their resource ceiling so unrelated files do not time out together;
		// local development retains the faster limit.
		maxWorkers: process.platform === "win32" ? (process.env.CI ? 2 : 8) : undefined,
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
