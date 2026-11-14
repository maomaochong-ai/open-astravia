// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeaderActionGroup, resolveVisibleCount, type HeaderActionItem } from "@astravia-org/theme-ui/chat/HeaderActionGroupView";

afterEach(cleanup);

const labels = { more: "更多操作" };

function items(count: number): HeaderActionItem[] {
	return Array.from({ length: count }, (_, index) => ({
		id: `a${index}`,
		title: `动作 ${index}`,
		icon: "icon-[solar--star-linear]",
		onClick: vi.fn(),
	}));
}

/**
 * 顶栏收纳的两条边界：放得下就全显示；放不下就收进「更多」，且必须给「更多」按钮
 * 自己留出位置（否则会多显示一个被裁掉一半的按钮）。
 */
describe("顶栏动作组的收纳", () => {
	it("宽度足够时全部显示，不出现「更多」", () => {
		render(<HeaderActionGroup items={items(3)} labels={labels} availableWidth={400} />);
		expect(screen.queryByRole("button", { name: "更多操作" })).toBeNull();
		expect(screen.getAllByRole("button")).toHaveLength(3);
	});

	it("放不下时收进「更多」，数量按容器宽度算", () => {
		// 5 个 32px 按钮 + 4px 内边距 = 164；给 100 只放得下 2 个，且要给「更多」留 32。
		render(<HeaderActionGroup items={items(5)} labels={labels} availableWidth={100} />);
		expect(screen.getAllByRole("button")).toHaveLength(3); // 2 个动作 + 更多
		expect(screen.getByRole("button", { name: "更多操作" })).toBeTruthy();
	});

	it("resolveVisibleCount：刚好放下时不留「更多」的位置", () => {
		// 可用宽度 = 容器宽 - 组内边距(4)。刚好 3×32=96 时三个都放得下。
		expect(resolveVisibleCount(3, 32 * 3 + 4)).toBe(3);
		// 少 1px 就只放得下 2 个；而 2 个 + 「更多」需要 96 > 95，所以只剩 1 个。
		expect(resolveVisibleCount(3, 32 * 3 + 3)).toBe(1);
		// 5 个按钮、容器只够 4 个：前 4 个占满 128px，再放「更多」需要 160，
		// 于是让出一个位置 → 显示 3 个 + 更多（96 + 32 = 128，刚好齐）。
		expect(resolveVisibleCount(5, 32 * 4 + 4)).toBe(3);
	});

	it("宽度未测量出来（0）时全部显示，不凭空少按钮", () => {
		render(<HeaderActionGroup items={items(4)} labels={labels} availableWidth={0} />);
		expect(screen.getAllByRole("button")).toHaveLength(4);
	});

	it("点可见动作只触发它自己", () => {
		const list = items(2);
		render(<HeaderActionGroup items={list} labels={labels} availableWidth={400} />);
		fireEvent.click(screen.getByRole("button", { name: "动作 1" }));
		expect(list[1]?.onClick).toHaveBeenCalledOnce();
		expect(list[0]?.onClick).not.toHaveBeenCalled();
	});
});
