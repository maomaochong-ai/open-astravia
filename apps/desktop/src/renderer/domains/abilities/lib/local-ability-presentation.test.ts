import type { LocalAbilityPresentations } from "@preload/api";
import { describe, expect, it } from "vitest";
import type { PluginAbility } from "../types";
import { withLocalAbilityPresentation } from "./local-ability-presentation";

function item(overrides: Partial<PluginAbility> = {}): PluginAbility {
	return {
		type: "plugin",
		id: "server:server:plugin:feishu",
		slug: "feishu",
		catalogSource: { kind: "server", id: "server" },
		title: "Feishu",
		description: "catalog description",
		category: "",
		tags: [],
		author: "",
		license: "",
		version: "1.2.3",
		installed: true,
		enabled: true,
		readonly: false,
		needsUpdate: false,
		setupRequired: false,
		busy: false,
		downloadCount: 0,
		isCustom: false,
		isBuiltin: false,
		fromMarket: true,
		searchTerms: [],
		icon: "catalog-icon",
		detail: { content: "catalog detail" },
		plugin: null,
		permissions: [],
		grantedPermissions: [],
		commands: [],
		grantedCommands: [],
		...overrides,
	};
}

const presentations: LocalAbilityPresentations = {
	"plugin:feishu": { icon: "package-icon", detail: { content: "package detail" } },
};

describe("withLocalAbilityPresentation", () => {
	it("overlays icon and detail for an installed ability", () => {
		expect(withLocalAbilityPresentation(item(), presentations)).toMatchObject({
			icon: "package-icon",
			detail: { content: "package detail" },
		});
	});

	it("does not apply local package data to an uninstalled catalog item", () => {
		const catalogItem = item({ installed: false });
		expect(withLocalAbilityPresentation(catalogItem, presentations)).toBe(catalogItem);
	});

	it("applies local data to builtin entries without an install record", () => {
		expect(
			withLocalAbilityPresentation(item({ installed: false, isBuiltin: true }), {
				"plugin:feishu": { icon: "builtin-package-icon" },
			}).icon,
		).toBe("builtin-package-icon");
	});
});
