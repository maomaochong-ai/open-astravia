import { describe, expect, it } from "vitest";
import { buildPluginSkillSources, findPluginSkillSource } from "./skill-provenance";

describe("plugin skill provenance", () => {
	it("retains the plugin id and icon for a contributed skill path", () => {
		const sources = buildPluginSkillSources(
			[{ pluginId: "content-creation", paths: ["C:\\plugins\\content\\skills\\"] }],
			new Map([["content-creation", "vetta-plugin://content/icon.png"]]),
		);

		expect(findPluginSkillSource("C:/plugins/content/skills/campaign/SKILL.md", sources)).toEqual({
			pluginId: "content-creation",
			root: "C:/plugins/content/skills",
			icon: "vetta-plugin://content/icon.png",
		});
	});

	it("uses the most specific root and does not match sibling prefixes", () => {
		const sources = buildPluginSkillSources(
			[
				{ pluginId: "parent", paths: ["/plugins/content"] },
				{ pluginId: "nested", paths: ["/plugins/content/skills"] },
			],
			new Map(),
		);

		expect(findPluginSkillSource("/plugins/content/skills/image/SKILL.md", sources)?.pluginId).toBe("nested");
		expect(findPluginSkillSource("/plugins/content-other/SKILL.md", sources)).toBeUndefined();
	});
});
