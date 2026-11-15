// @vitest-environment jsdom
import { OVERLAY_BACKDROP_CLASS, PANEL_SHADOW_CLASS } from "@astravia-org/ui/utils";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
	CommandMenuGroupView,
	CommandMenuItemView,
	CommandMenuViewProps,
} from "@astravia-org/theme-ui/overlays";
import { CommandMenuView } from "@astravia-org/theme-ui/overlays";
import { describe, expect, it, vi } from "vitest";

const labels = {
	placeholder: "Search projects, sessions, settings…",
	empty: "No results",
	emptyHint: "Try a different keyword",
	loading: "Searching sessions",
	title: "Command Menu",
	hintNavigate: "↑↓ Navigate",
	hintSelect: "↵ Open",
	hintClose: "esc Close",
};

function item(overrides: Partial<CommandMenuItemView> = {}): CommandMenuItemView {
	return {
		id: "project:demo",
		title: "demo",
		titleHighlights: [],
		icon: "icon-[solar--folder-linear]",
		...overrides,
	};
}

function props(overrides: Partial<CommandMenuViewProps> = {}): CommandMenuViewProps {
	return {
		open: true,
		query: "",
		groups: [],
		selectedId: null,
		labels,
		suppressSelectionAnimation: false,
		onQueryChange: vi.fn(),
		onHoverItem: vi.fn(),
		onActivateItem: vi.fn(),
		onClose: vi.fn(),
		...overrides,
	};
}

function group(overrides: Partial<CommandMenuGroupView> = {}): CommandMenuGroupView {
	return { key: "projects", label: "Projects", items: [item()], ...overrides };
}

/**
 * ⌘K 面板的外壳必须与「添加项目」「管理会话」等面板共用同一份 `SplashPanel`：
 * 遮罩、入场动效、面板圆角与外投影只在那里定义一次。这里断言它确实用的是平台
 * 统一的那两个样式常量——自己再写一套 `bg-background/70` + `shadow-2xl` 会在这两条上失败。
 */
describe("CommandMenuView 外壳", () => {
	it("用平台统一的遮罩与面板投影，而不是自带一套", () => {
		render(<CommandMenuView {...props()} />);
		const dialog = screen.getByRole("dialog", { name: "Command Menu" });
		const backdrop = dialog.parentElement as HTMLElement;

		for (const token of OVERLAY_BACKDROP_CLASS.split(" ")) {
			expect(backdrop.className).toContain(token);
		}
		for (const token of PANEL_SHADOW_CLASS.split(" ")) {
			expect(dialog.className).toContain(token);
		}
		// 旧外壳自带一层更重的阴影，迁移后不应再出现。
		expect(dialog.className).not.toContain("shadow-2xl");
	}, 20_000);

	it("面板宽度与共享外壳一致（640px，窄窗自适应）", () => {
		render(<CommandMenuView {...props()} />);
		const dialog = screen.getByRole("dialog", { name: "Command Menu" });
		// SplashPanel 用行内 width 表达「较窄时让出边距」，类名里不再写死宽度。
		expect(dialog.style.width).toContain("640px");
		expect(dialog.style.width).toContain("100vw");
		// 旧外壳把宽度写死在 class 里，迁移后不再有这一层。
		expect(dialog.className).not.toContain("w-[min(640px");
	}, 20_000);
});

describe("CommandMenuView", () => {
	it("renders nothing while closed and mounts the dialog once opened", () => {
		const { rerender } = render(<CommandMenuView {...props({ open: false })} />);
		expect(screen.queryByRole("dialog")).toBeNull();

		rerender(<CommandMenuView {...props({ open: true })} />);
		expect(screen.getByRole("dialog", { name: "Command Menu" })).toBeTruthy();
	});

	it("keeps the fixed group order regardless of how many results each group has", () => {
		const groups = [
			group({ key: "projects", label: "Projects", items: [item({ id: "p1", title: "alpha" })] }),
			group({
				key: "sessions",
				label: "Sessions",
				items: [
					item({ id: "s1", title: "beta" }),
					item({ id: "s2", title: "gamma" }),
					item({ id: "s3", title: "delta" }),
				],
			}),
			group({ key: "settings", label: "Settings", items: [item({ id: "st1", title: "Language" })] }),
		];
		render(<CommandMenuView {...props({ groups })} />);

		const rendered = screen.getAllByRole("group").map((node) => node.getAttribute("aria-label"));
		expect(rendered).toEqual(["Projects", "Sessions", "Settings"]);
	});

	it("hides empty groups but keeps a loading group visible with a skeleton placeholder", () => {
		const groups = [
			group({ key: "projects", label: "Projects", items: [] }),
			group({ key: "sessions", label: "Sessions", items: [], loading: true }),
		];
		render(<CommandMenuView {...props({ groups, query: "abc" })} />);

		expect(screen.queryByRole("group", { name: "Projects" })).toBeNull();
		const sessions = screen.getByRole("group", { name: "Sessions" });
		expect(within(sessions).getByLabelText("Searching sessions")).toBeTruthy();
		// 骨架在场时不算“无结果”，否则会在异步结果到达前闪一次空态。
		expect(screen.queryByText("No results")).toBeNull();
	});

	it("shows the empty state only when nothing is pending", () => {
		render(<CommandMenuView {...props({ query: "zzz", groups: [] })} />);
		expect(screen.getByText("No results")).toBeTruthy();
		expect(screen.getByText("Try a different keyword")).toBeTruthy();
	});

	it("renders the per-group overflow label when results are capped", () => {
		const groups = [group({ overflowLabel: "12 more" })];
		render(<CommandMenuView {...props({ groups })} />);
		expect(screen.getByText("12 more")).toBeTruthy();
	});

	it("marks the selected row and links it to the input for assistive tech", () => {
		const groups = [
			group({ items: [item({ id: "p1", title: "alpha" }), item({ id: "p2", title: "beta" })] }),
		];
		render(<CommandMenuView {...props({ groups, selectedId: "p2" })} />);

		const options = screen.getAllByRole("option");
		expect(options.map((node) => node.getAttribute("aria-selected"))).toEqual(["false", "true"]);
		expect(screen.getByRole("combobox").getAttribute("aria-activedescendant")).toBe("command-menu-item-p2");
	});

	it("renders unavailable rows as disabled with their reason instead of dropping them", async () => {
		const onActivateItem = vi.fn();
		const groups = [
			group({
				items: [item({ id: "s1", title: "locked", disabled: true, disabledReason: "No access" })],
			}),
		];
		render(<CommandMenuView {...props({ groups, onActivateItem })} />);

		const option = screen.getByRole("option", { name: /locked/ });
		expect(option.getAttribute("aria-disabled")).toBe("true");
		expect(option.getAttribute("title")).toBe("No access");
		await userEvent.click(option);
		expect(onActivateItem).not.toHaveBeenCalled();
	});

	it("splits the title into highlighted and plain segments from the given ranges", () => {
		const groups = [
			group({
				items: [
					item({ id: "p1", title: "maomaochong-ai", titleHighlights: [{ start: 4, end: 9 }] }),
				],
			}),
		];
		render(<CommandMenuView {...props({ groups })} />);

		// 面板 portal 到 body：查询要落在 document 上，渲染容器里是空的。
		const hits = Array.from(document.querySelectorAll(".text-primary")).map((node) => node.textContent);
		// 区间 4..9 落在 "maomaochong-ai" 上就是这五个字符（原断言写的是 "astravia"，
		// 与输入对不上，在迁移前就一直是红的）。
		expect(hits).toEqual(["aocho"]);
		// 拆成多个 span 后可访问名会被插入空格，故按原始文本断言拼接无损。
		expect(screen.getByRole("option").textContent).toBe("maomaochong-ai");
	});

	it("lets a long subtitle give way instead of squeezing the title", () => {
		const groups = [
			group({
				items: [
					item({
						id: "a1",
						title: "astravia-testing",
						subtitle: "为 OpenAstravia 的功能变更、Bug 修复、重构、公共合同和 UI 交互设计、编写或审查测试",
					}),
				],
			}),
		];
		render(<CommandMenuView {...props({ groups })} />);

		const [title, subtitle] = Array.from(document.querySelectorAll("[role='option'] > span > span"));
		// 标题不收缩、只受上限约束；副标题吃掉剩余宽度并自己截断。
		expect(title.className).toContain("shrink-0");
		expect(title.className).toContain("max-w-[60%]");
		expect(subtitle.className).toContain("flex-1");
		expect(subtitle.className).toContain("min-w-0");
	});

	it("activates a row on click and reports hover for selection follow", async () => {
		const onActivateItem = vi.fn();
		const onHoverItem = vi.fn();
		const groups = [group({ items: [item({ id: "p1", title: "alpha" })] })];
		render(<CommandMenuView {...props({ groups, onActivateItem, onHoverItem })} />);

		await userEvent.click(screen.getByRole("option", { name: /alpha/ }));
		expect(onActivateItem).toHaveBeenCalledWith("p1");
		expect(onHoverItem).toHaveBeenCalledWith("p1");
	});

	it("closes when the backdrop is pressed but not when the panel itself is", async () => {
		const onClose = vi.fn();
		const groups = [group()];
		render(<CommandMenuView {...props({ groups, onClose })} />);

		await userEvent.click(screen.getByRole("dialog"));
		expect(onClose).not.toHaveBeenCalled();

		const backdrop = screen.getByRole("dialog").parentElement as HTMLElement;
		await userEvent.click(backdrop);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("reports typing through onQueryChange without owning the value", async () => {
		const onQueryChange = vi.fn();
		render(<CommandMenuView {...props({ onQueryChange })} />);

		await userEvent.type(screen.getByRole("combobox"), "g");
		expect(onQueryChange).toHaveBeenCalledWith("g");
		expect(screen.getByRole("combobox").getAttribute("value")).toBe("");
	});
});
