// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
	CommandMenuGroupView,
	CommandMenuItemView,
	CommandMenuViewProps,
} from "@vetta/theme-ui/overlays";
import { CommandMenuView } from "@vetta/theme-ui/overlays";
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
					item({ id: "p1", title: "openvetta", titleHighlights: [{ start: 4, end: 9 }] }),
				],
			}),
		];
		const { container } = render(<CommandMenuView {...props({ groups })} />);

		const hits = Array.from(container.querySelectorAll(".text-primary")).map((node) => node.textContent);
		expect(hits).toContain("vetta");
		// 拆成多个 span 后可访问名会被插入空格，故按原始文本断言拼接无损。
		expect(screen.getByRole("option").textContent).toBe("openvetta");
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
