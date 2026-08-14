import { describe, expect, it } from "vitest";
import { findPackageBoundaryViolations } from "./check-package-boundaries.mjs";

describe("runtime-storage protocol boundary", () => {
	it("rejects Node environment imports", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/runtime-storage/src/conversation/file-adapter.ts",
				'import { readFile } from "node:fs/promises";',
			),
		).toContainEqual(expect.stringContaining("runtime-storage protocol must not import platform implementation"));
	});

	it("rejects platform runtime imports", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/runtime-storage/src/conversation/default-adapter.ts",
				'import { FileConversationRepository } from "@vetta/runtime-node/conversation";',
			),
		).toContainEqual(expect.stringContaining("runtime-storage protocol must not import platform implementation"));
	});

	it("allows platform-neutral contracts", () => {
		expect(
			findPackageBoundaryViolations(
				"packages/runtime-storage/src/conversation/contracts.ts",
				'import type { ConversationRepository } from "@vetta/runtime-core/kernel";',
			),
		).toEqual([]);
	});
});
