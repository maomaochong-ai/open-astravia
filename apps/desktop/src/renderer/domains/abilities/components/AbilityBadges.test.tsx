// @vitest-environment jsdom

import { i18n, initI18n } from "@shared/i18n";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SkillAbility } from "../types";
import { AbilityStatusBadges } from "./AbilityBadges";

function mockAbility(overrides: Partial<SkillAbility> = {}): SkillAbility {
	return {
		id: "skill:test",
		slug: "test",
		type: "skill" as const,
		catalogSource: { kind: "local", id: "local" },
		title: "Test",
		description: "",
		category: "General",
		tags: [],
		author: "",
		license: "MIT",
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
		fromMarket: false,
		searchTerms: ["test"],
		...overrides,
	};
}

describe("AbilityStatusBadges", () => {
	it("renders builtin badge for preset capabilities in Chinese and English", async () => {
		initI18n();
		await i18n.changeLanguage("zh");

		const presetItem = mockAbility({ isBuiltin: true });
		const { rerender } = render(<AbilityStatusBadges item={presetItem} />);
		expect(screen.getByText("内建")).toBeTruthy();

		await i18n.changeLanguage("en");
		rerender(<AbilityStatusBadges item={presetItem} />);
		expect(screen.getByText("Built-in")).toBeTruthy();
	});

	it("does not render builtin badge for non-preset capabilities", async () => {
		initI18n();
		await i18n.changeLanguage("zh");

		const nonPresetItem = mockAbility({ isBuiltin: false });
		render(<AbilityStatusBadges item={nonPresetItem} />);
		expect(screen.queryByText("内建")).toBeNull();
		expect(screen.queryByText("Built-in")).toBeNull();
	});
});
