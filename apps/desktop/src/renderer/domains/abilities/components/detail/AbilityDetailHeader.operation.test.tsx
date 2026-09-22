// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AbilityItem } from "../../types";
import { AbilityDetailHeader } from "./AbilityDetailHeader";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) =>
			({
				"detail.meta.installedVersion": "已安装",
				"detail.meta.availableVersion": "可更新至",
			})[key] ?? key,
	}),
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
	it("labels the installed and available versions in update order", () => {
		const item = {
			...updatingAbility("updating"),
			busy: false,
			operation: undefined,
			localVersion: "1.0.0",
			version: "2.0.0",
		} as AbilityItem;

		render(<AbilityDetailHeader item={item} onPrimary={vi.fn()} onSecondary={vi.fn()} />);

		expect(screen.getByText("已安装").parentElement?.textContent).toBe("已安装1.0.0可更新至2.0.0");
	});

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
