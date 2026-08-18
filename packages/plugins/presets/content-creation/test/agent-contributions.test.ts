import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface ContentCreationManifest {
	permissions?: string[];
	agent?: {
		skillPaths?: string[];
		systemPrompt?: {
			promptPaths?: string[];
		};
	};
}

describe("content creation agent contributions", () => {
	it("contributes a static workflow-routing prompt and on-demand skills", () => {
		const manifest = JSON.parse(
			readFileSync(new URL("../plugin.json", import.meta.url), "utf8"),
		) as ContentCreationManifest;
		const routingPrompt = readFileSync(
			new URL("../agent/prompts/content-workflow-routing.md", import.meta.url),
			"utf8",
		);

		expect(manifest.agent?.skillPaths).toEqual(["agent/skills"]);
		expect(manifest.agent?.systemPrompt?.promptPaths).toEqual([
			"agent/prompts/content-workflow-routing.md",
		]);
		expect(manifest.permissions).toContain("agent.systemPrompt.write");
		expect(manifest.permissions).not.toContain("agent.systemPrompt.fullControl");
		expect(routingPrompt).toContain("Use the content-creation tools and skills when");
		expect(routingPrompt).toContain(
			"Do not use the content-creation tools or invoke the content-creation skills when",
		);
		expect(routingPrompt).toContain("one simple, one-off image or video immediately");
		expect(routingPrompt).toContain("choose the least-complex path");
	});
});
