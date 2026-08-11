import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const codingAgentSrc = fileURLToPath(new URL("../coding-agent/src", import.meta.url));

export default defineConfig({
	resolve: {
		alias: [
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
				replacement: fileURLToPath(new URL("../coding-agent/src/adapters/runtime-tools/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/coding-agent/composition",
				replacement: fileURLToPath(new URL("../coding-agent/src/composition/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/coding-agent/bootstrap",
				replacement: fileURLToPath(new URL("../coding-agent/src/public-api/bootstrap.ts", import.meta.url)),
			},
			{
				find: "@vetta/coding-agent/cli-control",
				replacement: fileURLToPath(new URL("../coding-agent/src/public-api/cli-control.ts", import.meta.url)),
			},
			{
				find: "@vetta/coding-agent/export-html",
				replacement: fileURLToPath(new URL("../coding-agent/src/public-api/export-html.ts", import.meta.url)),
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
				find: "@vetta/coding-agent/rpc",
				replacement: fileURLToPath(new URL("../coding-agent/src/public-api/rpc.ts", import.meta.url)),
			},
			{
				find: "@vetta/coding-agent/runtime",
				replacement: fileURLToPath(new URL("../coding-agent/src/public-api/runtime.ts", import.meta.url)),
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
				find: "@vetta/runtime-core",
				replacement: fileURLToPath(new URL("../runtime-core/src/index.ts", import.meta.url)),
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
				find: "@vetta/runtime-subagents",
				replacement: fileURLToPath(new URL("../runtime-subagents/src/index.ts", import.meta.url)),
			},
			{
				find: "@vetta/runtime-tools/coding",
				replacement: fileURLToPath(new URL("../runtime-tools/src/coding/index.ts", import.meta.url)),
			},
		],
	},
	test: {
		environment: "node",
	},
});
