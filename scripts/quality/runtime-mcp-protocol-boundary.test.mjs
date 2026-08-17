import { describe, expect, it } from "vitest";
import { findPackageBoundaryViolations } from "./check-package-boundaries.mjs";

describe("runtime-mcp protocol boundary", () => {
	it("rejects Node environment imports", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/runtime-mcp/src/config/file-source.ts",
				'import { readFile } from "node:fs/promises";',
			),
		).toContainEqual(expect.stringContaining("runtime-mcp protocol must not import platform implementation"));
	});

	it("rejects platform runtime imports", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/runtime-mcp/src/client/default-client.ts",
				'import { createMcpClient } from "@vetta/runtime-node/mcp";',
			),
		).toContainEqual(expect.stringContaining("runtime-mcp protocol must not import platform implementation"));
	});

	it("allows the official protocol SDK and runtime kernel contracts", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/runtime-mcp/src/client/client-factory.ts",
				'import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";\nimport type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";',
			),
		).toEqual([]);
	});
});
