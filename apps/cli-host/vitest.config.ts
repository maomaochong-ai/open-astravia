import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const codingAgentSrc = fileURLToPath(new URL("../../packages/coding-agent/src", import.meta.url));

export default defineConfig({
	resolve: {
		alias: [
			{
				find: "@astravia/runtime-core/configuration",
				replacement: fileURLToPath(
					new URL("../../packages/runtime-core/src/configuration/index.ts", import.meta.url),
				),
			},
			{
				find: "@astravia/runtime-core/observation",
				replacement: fileURLToPath(
					new URL("../../packages/runtime-core/src/observation/index.ts", import.meta.url),
				),
			},
			{
				find: "@astravia/runtime-node/conversation/legacy",
				replacement: fileURLToPath(new URL("../../packages/runtime-node/src/conversation/legacy.ts", import.meta.url)),
			},
			{
				find: "@astravia/ai",
				replacement: fileURLToPath(new URL("../../packages/ai/src/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/agent-core",
				replacement: fileURLToPath(new URL("../../packages/agent/src/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/ecosystem-adapter",
				replacement: fileURLToPath(new URL("../../packages/ecosystem-adapter/src/index.ts", import.meta.url)),
			},
			// Stable public host surface (package exports "./host")
			{
				find: "@astravia/coding-agent/host",
				replacement: fileURLToPath(
					new URL("../../packages/coding-agent/src/host/tool-environment/node/index.ts", import.meta.url),
				),
			},
			{
				find: "@astravia/coding-agent/composition",
				replacement: fileURLToPath(new URL("../../packages/coding-agent/src/composition/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/coding-agent/model-context",
				replacement: fileURLToPath(new URL("../../packages/coding-agent/src/public-api/model-context.ts", import.meta.url)),
			},
			{
				find: "@astravia/coding-agent/session-extensions",
				replacement: fileURLToPath(
					new URL("../../packages/coding-agent/src/public-api/session-extensions.ts", import.meta.url),
				),
			},
			{
				find: "@astravia/coding-agent/function-extensions",
				replacement: fileURLToPath(
					new URL("../../packages/coding-agent/src/public-api/function-extensions.ts", import.meta.url),
				),
			},
			{
				find: "@astravia/coding-agent/plugin-runtime",
				replacement: fileURLToPath(
					new URL("../../packages/coding-agent/src/public-api/plugin-runtime.ts", import.meta.url),
				),
			},
			{
				find: "@astravia/coding-agent/bootstrap",
				replacement: fileURLToPath(new URL("../../packages/coding-agent/src/public-api/bootstrap.ts", import.meta.url)),
			},
			{
				find: "@astravia/coding-agent/export-html",
				replacement: fileURLToPath(new URL("../../packages/coding-agent/src/public-api/export-html.ts", import.meta.url)),
			},
			{
				find: "@astravia/coding-agent/extensions",
				replacement: fileURLToPath(new URL("../../packages/coding-agent/src/public-api/extensions.ts", import.meta.url)),
			},
			{
				find: "@astravia/coding-agent/config",
				replacement: fileURLToPath(new URL("../../packages/coding-agent/src/config.ts", import.meta.url)),
			},
			{
				find: "@astravia/coding-agent/hooks",
				replacement: fileURLToPath(new URL("../../packages/coding-agent/src/public-api/hooks.ts", import.meta.url)),
			},
			{
				find: "@astravia/coding-agent/host-services",
				replacement: fileURLToPath(new URL("../../packages/coding-agent/src/public-api/host-services.ts", import.meta.url)),
			},
			{
				find: "@astravia/coding-agent/historical-sessions",
				replacement: fileURLToPath(
					new URL("../../packages/coding-agent/src/public-api/historical-sessions.ts", import.meta.url),
				),
			},
			{
				find: "@astravia/coding-agent/profile",
				replacement: fileURLToPath(new URL("../../packages/coding-agent/src/public-api/profile.ts", import.meta.url)),
			},
			{
				find: "@astravia/coding-agent/resources",
				replacement: fileURLToPath(new URL("../../packages/coding-agent/src/public-api/resources.ts", import.meta.url)),
			},
			{
				find: "@astravia/coding-agent/rpc",
				replacement: fileURLToPath(new URL("../../packages/coding-agent/src/public-api/rpc.ts", import.meta.url)),
			},
			{
				find: "@astravia/coding-agent/runtime",
				replacement: fileURLToPath(new URL("../../packages/coding-agent/src/public-api/runtime.ts", import.meta.url)),
			},
			{
				find: "@astravia/coding-agent/settings",
				replacement: fileURLToPath(new URL("../../packages/coding-agent/src/public-api/settings.ts", import.meta.url)),
			},
			// Deep imports use ESM ".js" suffix; map to monorepo TypeScript sources
			{
				find: /^@astravia\/coding-agent\/(.+)\.js$/,
				replacement: `${codingAgentSrc}/$1.ts`,
			},
			{
				find: "@astravia/coding-agent",
				replacement: fileURLToPath(new URL("../../packages/coding-agent/src/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/runtime-core/kernel",
				replacement: fileURLToPath(new URL("../../packages/runtime-core/src/kernel/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/runtime-core/conversation",
				replacement: fileURLToPath(new URL("../../packages/runtime-core/src/conversation/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/runtime-core/sandbox",
				replacement: fileURLToPath(new URL("../../packages/runtime-core/src/sandbox/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/runtime-core/session-extensions",
				replacement: fileURLToPath(
					new URL("../../packages/runtime-core/src/session-extensions/index.ts", import.meta.url),
				),
			},
			{
				find: "@astravia/runtime-core/failures",
				replacement: fileURLToPath(
					new URL("../../packages/runtime-core/src/failures.ts", import.meta.url),
				),
			},
			{
				find: "@astravia/runtime-core",
				replacement: fileURLToPath(new URL("../../packages/runtime-core/src/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/runtime-mcp/auth",
				replacement: fileURLToPath(new URL("../../packages/runtime-mcp/src/auth/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/runtime-mcp/client",
				replacement: fileURLToPath(new URL("../../packages/runtime-mcp/src/client/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/runtime-mcp/config",
				replacement: fileURLToPath(new URL("../../packages/runtime-mcp/src/config/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/runtime-mcp/protocol",
				replacement: fileURLToPath(new URL("../../packages/runtime-mcp/src/protocol/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/runtime-mcp",
				replacement: fileURLToPath(new URL("../../packages/runtime-mcp/src/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/runtime-telemetry/langfuse",
				replacement: fileURLToPath(new URL("../../packages/runtime-telemetry/src/langfuse.ts", import.meta.url)),
			},
			{
				find: "@astravia/runtime-knowledge",
				replacement: fileURLToPath(new URL("../../packages/runtime-knowledge/src/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/runtime-storage/conversation",
				replacement: fileURLToPath(new URL("../../packages/runtime-storage/src/conversation/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/runtime-storage",
				replacement: fileURLToPath(new URL("../../packages/runtime-storage/src/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/action-rpc",
				replacement: fileURLToPath(new URL("../../packages/action-rpc/src/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/runtime-node/conversation",
				replacement: fileURLToPath(new URL("../../packages/runtime-node/src/conversation/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/runtime-node/host",
				replacement: fileURLToPath(new URL("../../packages/runtime-node/src/host/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/runtime-node/sandbox",
				replacement: fileURLToPath(new URL("../../packages/runtime-node/src/sandbox/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/runtime-node/coding",
				replacement: fileURLToPath(new URL("../../packages/runtime-node/src/coding/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/runtime-node/mcp",
				replacement: fileURLToPath(new URL("../../packages/runtime-node/src/mcp/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/runtime-subagents",
				replacement: fileURLToPath(new URL("../../packages/runtime-subagents/src/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/runtime-tools/coding",
				replacement: fileURLToPath(new URL("../../packages/runtime-tools/src/coding/index.ts", import.meta.url)),
			},
			{
				find: "@astravia/runtime-tools",
				replacement: fileURLToPath(new URL("../../packages/runtime-tools/src/index.ts", import.meta.url)),
			},
		],
	},
	test: {
		environment: "node",
		globalSetup: "./test/support/agent-rpc-global-setup.ts",
		// CLI contract tests launch nested Node, Bun, MCP and shell processes. Keep
		// Windows CI serial because shared runners can starve child processes; local
		// development retains bounded parallel collection for faster feedback.
		maxWorkers: process.platform === "win32" && process.env.CI ? 1 : 4,
	},
});
