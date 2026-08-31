import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({ resolve: { alias: {
	"@vetta/runtime-core/observation": fileURLToPath(new URL("../runtime-core/src/observation/index.ts", import.meta.url)),
	"@vetta/agent-core": fileURLToPath(new URL("../agent/src/index.ts", import.meta.url)),
} }, test: { environment: "node" } });
