import { describe, expect, it } from "vitest";
import { resolvePluginPresentationIcon, resolveProvidedSkillPresentationIcon } from "./ability-presentation";

describe("ability presentation icon policy", () => {
	it("prefers the installed package, then plugin manifest, then catalog", () => {
		expect(
			resolvePluginPresentationIcon({
				packageIcon: "package",
				manifestIcon: "manifest",
				catalogIcon: "catalog",
			}),
		).toBe("package");
		expect(resolvePluginPresentationIcon({ manifestIcon: "manifest", catalogIcon: "catalog" })).toBe("manifest");
		expect(resolvePluginPresentationIcon({ catalogIcon: "catalog" })).toBe("catalog");
	});

	it("prefers a skill declaration, then provider, catalog, and builtin fallback", () => {
		expect(
			resolveProvidedSkillPresentationIcon({
				skillIcon: "skill",
				providerIcon: "provider",
				catalogIcon: "catalog",
				builtinIcon: "builtin",
			}),
		).toBe("skill");
		expect(
			resolveProvidedSkillPresentationIcon({
				providerIcon: "provider",
				catalogIcon: "catalog",
				builtinIcon: "builtin",
			}),
		).toBe("provider");
		expect(resolveProvidedSkillPresentationIcon({ catalogIcon: "catalog", builtinIcon: "builtin" })).toBe("catalog");
		expect(resolveProvidedSkillPresentationIcon({ builtinIcon: "builtin" })).toBe("builtin");
		expect(resolveProvidedSkillPresentationIcon({})).toBeUndefined();
	});
});
