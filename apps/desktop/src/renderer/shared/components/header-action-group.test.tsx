// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	HeaderActionGroup,
	orderByKeepPriority,
	resolveVisibleCount,
	type HeaderActionItem,
} from "@astravia-org/theme-ui/chat/HeaderActionGroupView";

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

	it("按优先级决定谁先让位，但渲染顺序不变", () => {
		const list: HeaderActionItem[] = [
			{ id: "export", title: "导出", icon: "", onClick: vi.fn(), priority: 3 },
			{ id: "pin", title: "置顶", icon: "", onClick: vi.fn(), priority: 1 },
			{ id: "panel", title: "面板", icon: "", onClick: vi.fn(), priority: 5 },
		];
		// 只有两个名额时，优先级最低的「置顶」被收起。
		expect(orderByKeepPriority(list).map((item) => item.id)).toEqual(["panel", "export", "pin"]);
		expect(orderByKeepPriority(list).slice(0, 2).map((item) => item.id)).not.toContain("pin");
	});

	it("优先级相同时保持原顺序（不会随机重排）", () => {
		const list: HeaderActionItem[] = [
			{ id: "a", title: "a", icon: "", onClick: vi.fn() },
			{ id: "b", title: "b", icon: "", onClick: vi.fn() },
			{ id: "c", title: "c", icon: "", onClick: vi.fn() },
		];
		expect(orderByKeepPriority(list).map((item) => item.id)).toEqual(["a", "b", "c"]);
	});

	it("窄窗下被收起的是低优先级那个，可见项保持原顺序", () => {
		const { container } = render(
			<HeaderActionGroup
				items={[
					{ id: "export", title: "导出", icon: "icon-a", onClick: vi.fn(), priority: 3 },
					{ id: "pin", title: "置顶", icon: "icon-b", onClick: vi.fn(), priority: 1 },
					{ id: "panel", title: "面板", icon: "icon-c", onClick: vi.fn(), priority: 5 },
				]}
				labels={labels}
				// 74 - 4 = 70：一个按钮(32)+「更多」(32)=64 放得下，两个按钮(64)+更多=96 放不下。
				availableWidth={74}
			/>,
		);

		// 只剩一个名额：给优先级最高的「面板」，其余两项进菜单。
		const groupButtons = [...container.querySelectorAll('[role="group"] button')].map(
			(node) => node.getAttribute("aria-label") ?? "",
		);
		expect(groupButtons).toEqual(["面板", "更多操作"]);
		// 「更多」确实是一个菜单触发器（菜单内容由 Radix 在展开时才挂载，
		// jsdom 里无法稳定展开，这里只断言触发器形态）。
		expect(screen.getByRole("button", { name: "更多操作" }).getAttribute("aria-haspopup")).toBe("menu");
	});


	it("调整模式下全部动作都显示（不收纳），拖动上报新顺序", () => {
		const onReorder = vi.fn();
		const { container } = render(
			<HeaderActionGroup
				items={[
					{ id: "export", title: "导出", icon: "a", onClick: vi.fn() },
					{ id: "pin", title: "置顶", icon: "b", onClick: vi.fn() },
					{ id: "panel", title: "面板", icon: "c", onClick: vi.fn() },
				]}
				labels={labels}
				// 窄到放不下两个，但调整模式仍全部显示。
				availableWidth={74}
				editing
				onReorder={onReorder}
			/>,
		);

		expect(container.querySelectorAll("[data-header-action-id]")).toHaveLength(3);
		expect(screen.queryByRole("button", { name: "更多操作" })).toBeNull();

		// 把「面板」拖到「导出」的位置：新顺序应为 [panel, export, pin]。
		const dataTransfer = {
			store: new Map<string, string>(),
			setData(type: string, value: string) {
				this.store.set(type, value);
			},
			getData(type: string) {
				return this.store.get(type) ?? "";
			},
			effectAllowed: "move",
		};
		const handles = [...container.querySelectorAll("[data-header-action-id]")];
		fireEvent.dragStart(handles[2]!, { dataTransfer });
		fireEvent.drop(handles[0]!, { dataTransfer });
		expect(onReorder).toHaveBeenCalledWith(["panel", "export", "pin"]);
	});

	it("调整模式下点击某项切换显示状态，而不是执行动作", () => {
		const onClick = vi.fn();
		const onToggleVisibility = vi.fn();
		render(
			<HeaderActionGroup
				items={[{ id: "pin", title: "置顶", icon: "b", onClick }]}
				labels={labels}
				editing
				hiddenIds={["pin"]}
				onToggleVisibility={onToggleVisibility}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "置顶" }));
		expect(onToggleVisibility).toHaveBeenCalledWith("pin");
		expect(onClick).not.toHaveBeenCalled();
	});
});
