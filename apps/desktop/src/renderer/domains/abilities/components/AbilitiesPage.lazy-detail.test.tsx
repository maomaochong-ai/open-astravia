// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 能力页首开性能合同：详情抽屉壳同步可用，正文子树（markdown + shiki 高亮器）
 * 由抽屉内部按需加载；关闭时保留壳直到退出动画完成，但遮罩可立即穿透。
 */

const detailModuleEvaluated = vi.fn();
let latestOnExited: (() => void) | undefined;
vi.mock("./detail/AbilityDetailSheet", () => {
	detailModuleEvaluated();
	return {
		AbilityDetailSheet: ({ detailId, onExited }: { detailId: string | null; onExited?: () => void }) => {
			latestOnExited = onExited;
			return (
				<div data-testid="detail-sheet" data-detail-id={detailId ?? ""} />
			);
		},
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
		latestOnExited = undefined;
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
		expect(detailModuleEvaluated).not.toHaveBeenCalled();
	});

	it("detail 清空后保留抽屉直到退出动画完成，再允许卸载", async () => {
		searchState = { detail: "market:foo" };
		const { rerender } = render(<AbilitiesPage />);
		await waitFor(() => {
			expect(screen.getByTestId("detail-sheet")).toBeTruthy();
		});
		const evaluationsBeforeReopen = detailModuleEvaluated.mock.calls.length;

		searchState = {};
		rerender(<AbilitiesPage />);
		expect(screen.getByTestId("detail-sheet").getAttribute("data-detail-id")).toBe("");
		expect(latestOnExited).toBeTypeOf("function");
		act(() => latestOnExited?.());
		expect(screen.queryByTestId("detail-sheet")).toBeNull();

		searchState = { detail: "market:bar" };
		rerender(<AbilitiesPage />);
		await waitFor(() => expect(screen.getByTestId("detail-sheet").getAttribute("data-detail-id")).toBe("market:bar"));
		expect(detailModuleEvaluated.mock.calls.length).toBe(evaluationsBeforeReopen);
	});
});
