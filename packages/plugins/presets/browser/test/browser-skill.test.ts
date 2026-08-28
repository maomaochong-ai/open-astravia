import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Browser Use skill", () => {
	it("routes the Agent through an isolated upstream CLI session", async () => {
		const skill = await readFile(resolve(import.meta.dirname, "../agent/skills/browser-use/SKILL.md"), "utf8");
		expect(skill).toContain("agent-browser");
		expect(skill).toContain("VETTA_AGENT_SESSION_ID");
		expect(skill).toContain("--session");
		expect(skill).toContain("--pin-tab");
		expect(skill).toContain('click "@e1"');
		expect(skill).not.toContain("browser_operate");
	});
});
