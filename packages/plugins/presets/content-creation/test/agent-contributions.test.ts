import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface ContentCreationManifest {
	permissions?: string[];
	agent?: {
		skillPaths?: string[];
		systemPrompt?: unknown;
	};
}

describe("content creation agent contributions", () => {
	it("uses on-demand skills without plugin system-prompt mutation permissions", () => {
		const manifest = JSON.parse(
			readFileSync(new URL("../plugin.json", import.meta.url), "utf8"),
		) as ContentCreationManifest;

		expect(manifest.agent?.skillPaths).toEqual(["agent/skills"]);
		expect(manifest.agent?.systemPrompt).toBeUndefined();
		expect(manifest.permissions).not.toContain("agent.systemPrompt.write");
		expect(manifest.permissions).not.toContain("agent.systemPrompt.fullControl");
	});
});
