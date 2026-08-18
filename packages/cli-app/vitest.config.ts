import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const codingAgentSrc = fileURLToPath(new URL("../coding-agent/src", import.meta.url));

export default defineConfig({
	resolve: {
		alias: [
			{
				find: "@vetta/runtime-node/conversation/legacy",
				replacement: fileURLToPath(new URL("../runtime-node/src/conversation/legacy.ts", import.meta.url)),
			},
			{
				find: "@vetta/ai",
				replacement: fileURLToPath(new URL("../ai/src/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/agent-core",
				replacement: fileURLToPath(new URL("../agent/src/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/ecosystem-adapter",
				replacement: fileURLToPath(new URL("../ecosystem-adapter/src/index.ts", import.meta.url)),
			},
			// Stable public host surface (package exports "./host")
			{
				find: "@vetta/coding-agent/host",
				replacement: fileURLToPath(
					new URL("../coding-agent/src/host/tool-environment/node/index.ts", import.meta.url),
				),
			},
			{
				find: "@vetta/coding-agent/composition",
				replacement: fileURLToPath(new URL("../coding-agent/src/composition/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/coding-agent/model-context",
				replacement: fileURLToPath(new URL("../coding-agent/src/public-api/model-context.ts", import.meta.url)),
			},
			{
				find: "@vetta/coding-agent/session-extensions",
				replacement: fileURLToPath(
					new URL("../coding-agent/src/public-api/session-extensions.ts", import.meta.url),
				),
			},
			{
				find: "@vetta/coding-agent/bootstrap",
				replacement: fileURLToPath(new URL("../coding-agent/src/public-api/bootstrap.ts", import.meta.url)),
			},
			{
				find: "@vetta/coding-agent/export-html",
				replacement: fileURLToPath(new URL("../coding-agent/src/public-api/export-html.ts", import.meta.url)),
			},
			{
				find: "@vetta/coding-agent/extensions",
				replacement: fileURLToPath(new URL("../coding-agent/src/public-api/extensions.ts", import.meta.url)),
			},
			{
				find: "@vetta/coding-agent/config",
				replacement: fileURLToPath(new URL("../coding-agent/src/config.ts", import.meta.url)),
			},
			{
				find: "@vetta/coding-agent/hooks",
				replacement: fileURLToPath(new URL("../coding-agent/src/public-api/hooks.ts", import.meta.url)),
			},
			{
				find: "@vetta/coding-agent/host-services",
				replacement: fileURLToPath(new URL("../coding-agent/src/public-api/host-services.ts", import.meta.url)),
			},
			{
				find: "@vetta/coding-agent/historical-sessions",
				replacement: fileURLToPath(
					new URL("../coding-agent/src/public-api/historical-sessions.ts", import.meta.url),
				),
			},
			{
				find: "@vetta/coding-agent/profile",
				replacement: fileURLToPath(new URL("../coding-agent/src/public-api/profile.ts", import.meta.url)),
			},
			{
				find: "@vetta/coding-agent/resources",
				replacement: fileURLToPath(new URL("../coding-agent/src/public-api/resources.ts", import.meta.url)),
			},
			{
				find: "@vetta/coding-agent/rpc",
				replacement: fileURLToPath(new URL("../coding-agent/src/public-api/rpc.ts", import.meta.url)),
			},
			{
				find: "@vetta/coding-agent/runtime",
				replacement: fileURLToPath(new URL("../coding-agent/src/public-api/runtime.ts", import.meta.url)),
			},
			{
				find: "@vetta/coding-agent/settings",
				replacement: fileURLToPath(new URL("../coding-agent/src/public-api/settings.ts", import.meta.url)),
			},
			// Deep imports use ESM ".js" suffix; map to monorepo TypeScript sources
			{
				find: /^@vetta\/coding-agent\/(.+)\.js$/,
				replacement: `${codingAgentSrc}/$1.ts`,
			},
			{
				find: "@vetta/coding-agent",
				replacement: fileURLToPath(new URL("../coding-agent/src/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/runtime-core/kernel",
				replacement: fileURLToPath(new URL("../runtime-core/src/kernel/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/runtime-core/conversation",
				replacement: fileURLToPath(new URL("../runtime-core/src/conversation/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/runtime-core/sandbox",
				replacement: fileURLToPath(new URL("../runtime-core/src/sandbox/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/runtime-core/session-extensions",
				replacement: fileURLToPath(
					new URL("../runtime-core/src/session-extensions/index.ts", import.meta.url),
				),
			},
			{
				find: "@vetta/runtime-core",
				replacement: fileURLToPath(new URL("../runtime-core/src/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/runtime-mcp/auth",
				replacement: fileURLToPath(new URL("../runtime-mcp/src/auth/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/runtime-mcp/client",
				replacement: fileURLToPath(new URL("../runtime-mcp/src/client/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/runtime-mcp/config",
				replacement: fileURLToPath(new URL("../runtime-mcp/src/config/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/runtime-mcp/protocol",
				replacement: fileURLToPath(new URL("../runtime-mcp/src/protocol/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/runtime-mcp",
				replacement: fileURLToPath(new URL("../runtime-mcp/src/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/runtime-knowledge",
				replacement: fileURLToPath(new URL("../runtime-knowledge/src/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/runtime-storage/conversation",
				replacement: fileURLToPath(new URL("../runtime-storage/src/conversation/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/runtime-node/conversation",
				replacement: fileURLToPath(new URL("../runtime-node/src/conversation/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/runtime-node/host",
				replacement: fileURLToPath(new URL("../runtime-node/src/host/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/runtime-node/sandbox",
				replacement: fileURLToPath(new URL("../runtime-node/src/sandbox/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/runtime-node/coding",
				replacement: fileURLToPath(new URL("../runtime-node/src/coding/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/runtime-node/mcp",
				replacement: fileURLToPath(new URL("../runtime-node/src/mcp/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/runtime-subagents",
				replacement: fileURLToPath(new URL("../runtime-subagents/src/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/runtime-tools/coding",
				replacement: fileURLToPath(new URL("../runtime-tools/src/coding/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/runtime-tools",
				replacement: fileURLToPath(new URL("../runtime-tools/src/index.ts", import.meta.url)),
			},
		],
	},
	test: {
		environment: "node",
	},
});
