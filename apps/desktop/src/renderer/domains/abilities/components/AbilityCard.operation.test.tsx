// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AbilityCardActions } from "./AbilityCard";
import type { AbilityItem, SkillAbility } from "../types";
import { AbilityCard } from "./AbilityCard";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../hooks/useAbilityText", () => ({
	useAbilityText: () => (item: AbilityItem) => ({ title: item.title, description: item.description }),
}));
const iconRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock("./AbilityIcon", () => ({
	AbilityIcon: () => {
		iconRenders.count += 1;
		return <span aria-hidden="true" />;
	},
}));
vi.mock("./AbilityBadges", () => ({ AbilityStatusBadges: () => null }));
vi.mock("./detail/loadAbilityDetailView", () => ({ loadAbilityDetailView: async () => ({}) }));

function cardActions(): AbilityCardActions {
	return {
		install: vi.fn(),
		uninstall: vi.fn(),
		toggle: vi.fn(),
		reloadPlugin: vi.fn(),
		setup: vi.fn(),
		configure: vi.fn(),
		edit: vi.fn(),
		revokeAuthorization: vi.fn(),
	};
}

const actions = cardActions();

function ability(overrides: Partial<SkillAbility> = {}): SkillAbility {
	return {
		id: "skill:demo",
		slug: "demo",
		type: "skill",
		catalogSource: { kind: "local", id: "local" },
		title: "Demo ability",
		description: "Helps with a familiar task",
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
		searchTerms: ["demo"],
		...overrides,
	};
}

afterEach(cleanup);

describe("AbilityCard operation feedback", () => {
	it("replaces the description with installation progress without putting text inside the add button", () => {
		const view = render(<AbilityCard item={ability()} actions={actions} />);
		expect(screen.getByText("Helps with a familiar task")).toBeTruthy();
		expect(screen.getByRole("button", { name: "actions.add" })).toBeTruthy();

		view.rerender(
			<AbilityCard item={ability({ busy: true, operation: "installing" })} actions={actions} />,
		);

		const status = screen.getByRole("status");
		expect(status.textContent).toBe("operation.installing");
		expect(status.closest("button")).toBeNull();
		expect(screen.queryByText("Helps with a familiar task")).toBeNull();
		expect(screen.queryByRole("button", { name: "actions.add" })).toBeNull();

		view.rerender(<AbilityCard item={ability({ installed: true, enabled: true })} actions={actions} />);
		expect(screen.getByText("Helps with a familiar task")).toBeTruthy();
		expect(screen.getByRole("button", { name: "actions.more" })).toBeTruthy();
	});

	it("uses the same description-line feedback while removing an installed ability", () => {
		const view = render(
			<AbilityCard item={ability({ installed: true, enabled: true })} actions={actions} />,
		);
		expect(screen.getByText("Helps with a familiar task")).toBeTruthy();
		expect(screen.getByRole("button", { name: "actions.more" })).toBeTruthy();

		view.rerender(
			<AbilityCard
				item={ability({ installed: true, enabled: true, busy: true, operation: "removing" })}
				actions={actions}
			/>,
		);

		const status = screen.getByRole("status");
		expect(status.textContent).toBe("operation.removing");
		expect(status.closest("button")).toBeNull();
		expect(screen.queryByText("Helps with a familiar task")).toBeNull();
		expect(screen.queryByRole("button", { name: "actions.more" })).toBeNull();

		view.rerender(<AbilityCard item={ability()} actions={actions} />);
		expect(screen.getByText("Helps with a familiar task")).toBeTruthy();
		expect(screen.getByRole("button", { name: "actions.add" })).toBeTruthy();
	});

	it("skips redrawing a row whose props did not change", () => {
		const item = ability();
		const view = render(<AbilityCard item={item} actions={actions} />);
		const firstPaint = iconRenders.count;

		// 目录重算会重建外层数组，但筛出来的条目仍是同一批对象；
		// memo 命中就不该再走一遍行内的标题、徽标与进度分支。
		view.rerender(<AbilityCard item={item} actions={actions} />);
		expect(iconRenders.count).toBe(firstPaint);

		view.rerender(<AbilityCard item={{ ...item }} actions={actions} />);
		expect(iconRenders.count).toBe(firstPaint + 1);
	});
});
