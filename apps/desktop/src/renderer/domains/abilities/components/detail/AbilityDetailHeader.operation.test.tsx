// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AbilityItem } from "../../types";
import { AbilityDetailHeader } from "./AbilityDetailHeader";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../hooks/useAbilityText", () => ({
	useAbilityText: () => (item: AbilityItem) => ({ title: item.title, description: item.description }),
}));
vi.mock("../AbilityIcon", () => ({ AbilityIcon: () => <span /> }));
vi.mock("../AbilityBadges", () => ({
	AbilityStatusBadges: () => null,
	AbilityTypeBadge: () => null,
}));

function updatingAbility(operation: "updating" | "applyingUpdate"): AbilityItem {
	return {
		type: "skill",
		id: "skill:demo",
		slug: "demo",
		title: "Demo",
		description: "",
		installed: true,
		enabled: true,
		readonly: false,
		needsUpdate: true,
		setupRequired: false,
		busy: true,
		operation,
		tags: [],
		version: "2.0.0",
		author: "",
		license: "",
		downloadCount: 0,
	} as unknown as AbilityItem;
}

afterEach(cleanup);

describe("AbilityDetailHeader operation feedback", () => {
	it("shows the update and automatic reload phases in the primary action", () => {
		const view = render(
			<AbilityDetailHeader item={updatingAbility("updating")} onPrimary={vi.fn()} onSecondary={vi.fn()} />,
		);
		expect(screen.getByRole("status").textContent).toBe("operation.updating");
		expect(screen.getByRole("button", { name: "operation.updating" })).toBeTruthy();

		view.rerender(
			<AbilityDetailHeader item={updatingAbility("applyingUpdate")} onPrimary={vi.fn()} onSecondary={vi.fn()} />,
		);
		expect(screen.getByRole("status").textContent).toBe("operation.applyingUpdate");
		expect(screen.getByRole("button", { name: "operation.applyingUpdate" })).toBeTruthy();
	});
});
