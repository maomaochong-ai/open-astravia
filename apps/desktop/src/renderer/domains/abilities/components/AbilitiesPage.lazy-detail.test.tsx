// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 能力页首开性能合同：详情抽屉子树（markdown + shiki 高亮器）必须懒加载——
 * 没有 ?detail= 参数时不在同步渲染阶段求值它的模块；空闲或用户意图出现时才拉取，
 * 关闭后立即卸载抽屉，避免 Vaul 退出动画期间的遮罩继续拦截能力列表；
 * 动态模块本身仍留在浏览器缓存中，二次打开无需重新加载。
 */

const detailModuleEvaluated = vi.fn();
vi.mock("./detail/AbilityDetailSheet", () => {
	detailModuleEvaluated();
	return {
		AbilityDetailSheet: ({ detailId }: { detailId: string | null }) => (
			<div data-testid="detail-sheet" data-detail-id={detailId ?? ""} />
		),
	};
});

vi.mock("./AbilitiesPageView", () => ({
	AbilitiesPageView: () => <div data-testid="abilities-page-view" />,
}));
vi.mock("./PluginPermissionPrompt", () => ({
	PluginPermissionPrompt: () => null,
}));
vi.mock("../hooks/useAbilitiesModel", () => ({
	useAbilitiesModel: () => ({ findById: () => null, loading: false }),
}));

let searchState: { detail?: string } = {};
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	useSearch: () => searchState,
}));

const { AbilitiesPage } = await import("./AbilitiesPage.js");

describe("AbilitiesPage 详情抽屉懒加载", () => {
	beforeEach(() => {
		detailModuleEvaluated.mockClear();
		searchState = {};
	});

	it("无 detail 参数时不求值详情抽屉模块", async () => {
		render(<AbilitiesPage />);
		expect(screen.getByTestId("abilities-page-view")).toBeTruthy();
		// 留出微任务窗口，确认没有偷偷发起动态 import。
		await act(async () => {
			await Promise.resolve();
		});
		expect(detailModuleEvaluated).not.toHaveBeenCalled();
		expect(screen.queryByTestId("detail-sheet")).toBeNull();
	});

	it("带 detail 参数时懒加载并挂载详情抽屉", async () => {
		searchState = { detail: "market:foo" };
		render(<AbilitiesPage />);
		await waitFor(() => {
			expect(screen.getByTestId("detail-sheet").getAttribute("data-detail-id")).toBe("market:foo");
		});
		expect(detailModuleEvaluated).toHaveBeenCalled();
	});

	it("detail 清空后立即卸载抽屉，二次打开复用已加载模块", async () => {
		searchState = { detail: "market:foo" };
		const { rerender } = render(<AbilitiesPage />);
		await waitFor(() => {
			expect(screen.getByTestId("detail-sheet")).toBeTruthy();
		});
		const evaluationsBeforeReopen = detailModuleEvaluated.mock.calls.length;

		searchState = {};
		rerender(<AbilitiesPage />);
		expect(screen.queryByTestId("detail-sheet")).toBeNull();

		searchState = { detail: "market:bar" };
		rerender(<AbilitiesPage />);
		await waitFor(() => expect(screen.getByTestId("detail-sheet").getAttribute("data-detail-id")).toBe("market:bar"));
		expect(detailModuleEvaluated.mock.calls.length).toBe(evaluationsBeforeReopen);
	});
});
