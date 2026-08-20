import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(join(import.meta.dirname, "../../.github/workflows/desktop-release.yml"), "utf8");

describe("Desktop release workflow contracts", () => {
	it("runs quality and packaging tests before the platform matrix", () => {
		expect(workflow).toContain("  quality:");
		expect(workflow).toContain("run: bun run check");
		expect(workflow).toContain("run: bun run test:quality");
		expect(workflow).toContain("run: bun run verify:desktop:contracts");
		expect(workflow).toContain("run: bun run test:desktop:packaging");
		expect(workflow).toContain("needs: [prepare, quality]");
	});

	it("verifies the public update feed after either publish target", () => {
		expect(workflow.match(/node scripts\/verify-update-feed\.mjs/g)).toHaveLength(2);
		expect(workflow.match(/needs: \[prepare, quality, build\]/g)).toHaveLength(2);
	});
});
