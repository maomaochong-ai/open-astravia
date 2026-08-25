import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@vetta/agent-core": fileURLToPath(new URL("../agent/src/index.ts", import.meta.url)),
			"@vetta/runtime-node/conversation/legacy": fileURLToPath(
				new URL("./src/conversation/legacy.ts", import.meta.url),
			),
			"@vetta/runtime-node/host": fileURLToPath(new URL("./src/host/index.ts", import.meta.url)),
			"@vetta/runtime-node/sandbox": fileURLToPath(new URL("./src/sandbox/index.ts", import.meta.url)),
			"@vetta/runtime-node/coding": fileURLToPath(new URL("./src/coding/index.ts", import.meta.url)),
			"@vetta/runtime-node/mcp": fileURLToPath(new URL("./src/mcp/index.ts", import.meta.url)),
			"@vetta/runtime-node/conversation": fileURLToPath(
				new URL("./src/conversation/index.ts", import.meta.url),
			),
			"@vetta/runtime-node": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
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
			"@vetta/runtime-storage/conversation": fileURLToPath(
				new URL("../runtime-storage/src/conversation/index.ts", import.meta.url),
			),
			"@vetta/runtime-storage": fileURLToPath(new URL("../runtime-storage/src/index.ts", import.meta.url)),
			"@vetta/runtime-tools/coding": fileURLToPath(
				new URL("../runtime-tools/src/coding/index.ts", import.meta.url),
			),
			"@vetta/runtime-tools": fileURLToPath(new URL("../runtime-tools/src/index.ts", import.meta.url)),
			"@vetta/runtime-knowledge": fileURLToPath(
				new URL("../runtime-knowledge/src/index.ts", import.meta.url),
			),
			"@vetta/runtime-subagents": fileURLToPath(
				new URL("../runtime-subagents/src/index.ts", import.meta.url),
			),
			"@vetta/runtime-core/configuration": fileURLToPath(
				new URL("../runtime-core/src/configuration/index.ts", import.meta.url),
			),
			"@vetta/runtime-core/observation": fileURLToPath(
				new URL("../runtime-core/src/observation/index.ts", import.meta.url),
			),
			"@vetta/runtime-core/conversation": fileURLToPath(
				new URL("../runtime-core/src/conversation/index.ts", import.meta.url),
			),
			"@vetta/runtime-core/kernel": fileURLToPath(new URL("../runtime-core/src/kernel/index.ts", import.meta.url)),
			"@vetta/runtime-core/sandbox": fileURLToPath(
				new URL("../runtime-core/src/sandbox/index.ts", import.meta.url),
			),
			"@vetta/runtime-core": fileURLToPath(new URL("../runtime-core/src/index.ts", import.meta.url)),
		},
	},
	test: {
		environment: "node",
	},
});
