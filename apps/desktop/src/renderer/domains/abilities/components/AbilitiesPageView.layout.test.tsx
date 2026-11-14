// @vitest-environment jsdom
import type { AbilitiesModel, AbilityItem } from "../types";
import { EMPTY_ABILITY_FILTER } from "../types";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { i18n, initI18n } from "@shared/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 能力页布局合同（对应 ADR-0162）：工具条按「搜索左、筛选与添加右」排，
 * 横幅只在「发现」分区出现，卡片在窄宽度下一列、800px 以上两列。
 */

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@shared/components/cloud-slots", () => ({ cloudEnabled: false }));
vi.mock("@shared/tour", () => ({ CapabilitiesTour: () => null }));
vi.mock("../components/AbilityMcpDialogs", () => ({ AbilityMcpDialogs: () => null }));
vi.mock("./detail/loadAbilityDetailView", () => ({ loadAbilityDetailView: async () => ({}) }));

const { AbilitiesPageView } = await import("./AbilitiesPageView");

initI18n();
await i18n.changeLanguage("zh");

function makeItem(id: string): AbilityItem {
	return {
		id,
		slug: id,
		type: "skill",
		title: id,
		description: "",
		icon: "",
		installed: false,
		enabled: false,
		needsUpdate: false,
		fromMarket: true,
		catalogSource: { kind: "server" },
		busy: false,
	} as unknown as AbilityItem;
}

function makeModel(overrides: Partial<AbilitiesModel> = {}): AbilitiesModel {
	const items = [makeItem("alpha")];
	return {
		scope: "discover",
		setScope: vi.fn(),
		searchQuery: "",
		setSearchQuery: vi.fn(),
		filter: EMPTY_ABILITY_FILTER,
		setFilter: vi.fn(),
		typeCounts: {},
		items,
		groups: [],
		bannerIcons: [{ id: "alpha", type: "skill", title: "Alpha 能力", description: "简介", icon: "" }],
		loading: false,
		refreshing: false,
		errors: [],
		detailErrors: [],
		importing: false,
		mcp: {} as AbilitiesModel["mcp"],
		findById: () => null,
		refresh: vi.fn(),
		refreshLocalInstallState: async () => undefined,
		install: vi.fn(),
		uninstall: vi.fn(),
		toggle: vi.fn(),
		reloadPlugin: vi.fn(),
		setup: vi.fn(),
		configure: vi.fn(),
		edit: vi.fn(),
		revokeAuthorization: vi.fn(),
		startAddManualMcp: vi.fn(),
		importSkillArchive: vi.fn(),
		importPluginArchive: vi.fn(),
		...overrides,
	} as unknown as AbilitiesModel;
}

afterEach(() => cleanup());

describe("能力页布局", () => {
	it("发现分区展示横幅，切到个人分区后横幅不再渲染", () => {
		const { rerender } = render(<AbilitiesPageView model={makeModel()} />);
		expect(screen.getByText("推荐")).toBeTruthy();

		rerender(<AbilitiesPageView model={makeModel({ scope: "mine" })} />);
		expect(screen.queryByText("推荐")).toBeNull();
	});

	it("工具条把筛选与添加放在右侧容器，搜索留在左侧", () => {
		render(<AbilitiesPageView model={makeModel()} />);
		const toolbar = document.querySelector('[data-tour="capabilities-search-add"]');
		expect(toolbar).toBeTruthy();
		// 两级子节点：左（搜索）/ 右（筛选 + 添加）。筛选与添加同属右侧那一格。
		const [left, right] = Array.from(toolbar!.children);
		expect(left?.querySelector("input")).toBeTruthy();
		expect(right?.children.length).toBe(2);
	});

	it("卡片列表在窄宽度下为一列，800px 以上两列", () => {
		render(<AbilitiesPageView model={makeModel()} />);
		const grid = document.querySelector('[data-tour="capabilities-list"] .grid');
		expect(grid?.className).toContain("grid-cols-1");
		expect(grid?.className).toContain("min-[800px]:grid-cols-2");
	});

	it("刷新按钮是纯图标按钮，带可访问名与旋转提示", async () => {
		render(<AbilitiesPageView model={makeModel({ refreshing: true })} />);
		const refresh = screen.getByRole("button", { name: "刷新" });
		expect(refresh.querySelector("span")?.className).toContain("animate-spin");
		await waitFor(() => expect(refresh.hasAttribute("disabled")).toBe(true));
	});

	it("公开/个人切换位于页头，切换时调用 setScope", () => {
		const setScope = vi.fn();
		render(<AbilitiesPageView model={makeModel({ setScope })} />);
		const scope = document.querySelector('[data-tour="capabilities-scope"]');
		expect(scope).toBeTruthy();
		// 页头槽位在滚动容器之外。
		expect(scope?.closest(".overflow-y-auto")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "个人" }));
		expect(setScope).toHaveBeenCalledWith("mine");
	});
});
