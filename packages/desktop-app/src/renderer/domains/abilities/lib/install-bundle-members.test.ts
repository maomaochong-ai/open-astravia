import { describe, expect, it, vi } from "vitest";
import type { AbilityItem, SkillAbility } from "../types";
import { type InstallOutcome, installSelectedBundleMembers } from "./install-bundle-members";

function member(slug: string, overrides: Partial<SkillAbility> = {}): SkillAbility {
	return {
		type: "skill",
		id: `skill:${slug}`,
		slug,
		catalogSource: { kind: "server", id: "server" },
		title: slug,
		description: "",
		category: "",
		tags: [],
		author: "",
		license: "",
		version: "1.0.0",
		installed: false,
		enabled: false,
		readonly: false,
		needsUpdate: false,
		setupRequired: false,
		busy: false,
		downloadCount: 0,
		isCustom: false,
		isBuiltin: false,
		fromMarket: true,
		searchTerms: [slug],
		...overrides,
	};
}

describe("installSelectedBundleMembers", () => {
	it("installs only the selected members and de-duplicates them", async () => {
		const first = member("first");
		const third = member("third");
		const installOne = vi.fn(async (_item: AbilityItem): Promise<InstallOutcome> => "installed");

		const result = await installSelectedBundleMembers([first, third, first], installOne);

		expect(installOne.mock.calls.map(([item]) => item.id)).toEqual(["skill:first", "skill:third"]);
		expect(result).toEqual({ installedCount: 2 });
	});

	it("skips members that are already current or read-only", async () => {
		const installOne = vi.fn(async (_item: AbilityItem): Promise<InstallOutcome> => "installed");

		const result = await installSelectedBundleMembers(
			[member("installed", { installed: true }), member("builtin", { readonly: true, installed: true })],
			installOne,
		);

		expect(installOne).not.toHaveBeenCalled();
		expect(result).toEqual({ installedCount: 0 });
	});

	it("stops when a selected member requires setup", async () => {
		const first = member("first");
		const setup = member("setup");
		const last = member("last");
		const installOne = vi
			.fn<(item: AbilityItem) => Promise<InstallOutcome>>()
			.mockResolvedValueOnce("installed")
			.mockResolvedValueOnce("needs-setup")
			.mockResolvedValueOnce("installed");

		const result = await installSelectedBundleMembers([first, setup, last], installOne);

		expect(installOne).toHaveBeenCalledTimes(2);
		expect(result).toEqual({ installedCount: 1, setupItem: setup });
	});
});
