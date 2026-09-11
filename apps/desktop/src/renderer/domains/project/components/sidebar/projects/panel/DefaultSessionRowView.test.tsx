// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
	DefaultSessionRowView,
	type DefaultSessionRowViewProps,
	SessionRowView,
} from "@vetta/theme-ui/project";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

function props(overrides: Partial<DefaultSessionRowViewProps> = {}): DefaultSessionRowViewProps {
	return {
		active: false,
		contextMenuEnabled: false,
		label: "Conversation",
		renaming: false,
		running: false,
		scheduled: false,
		onOpenContextMenu: vi.fn(),
		onRename: vi.fn(),
		onRenameDone: vi.fn(),
		onSelect: vi.fn(),
		...overrides,
	};
}

describe("DefaultSessionRowView leading icon", () => {
	it("forwards the context-menu gesture for an enabled Team conversation row", () => {
		const onOpenContextMenu = vi.fn();
		const view = render(
			<DefaultSessionRowView
				{...props({
					contextMenuEnabled: true,
					iconClassName: "icon-[solar--users-group-rounded-linear]",
					label: "Team task",
					onOpenContextMenu,
				})}
			/>,
		);

		fireEvent.contextMenu(view.getByRole("button", { name: "Team task" }), {
			clientX: 24,
			clientY: 36,
		});

		expect(onOpenContextMenu).toHaveBeenCalledOnce();
	});

	it("renders exactly one icon when a source icon is provided", () => {
		const view = render(
			<DefaultSessionRowView {...props({ iconClassName: "icon-[solar--users-group-rounded-linear]" })} />,
		);

		expect(view.container.querySelectorAll('[data-session-leading-icon="true"]')).toHaveLength(1);
		expect(view.container.querySelector('[data-session-leading-icon="true"]')?.className).toContain(
			"icon-[solar--users-group-rounded-linear]",
		);
	});

	it("uses status precedence without adding another icon", () => {
		const view = render(
			<DefaultSessionRowView
				{...props({
					iconClassName: "icon-[solar--users-group-rounded-linear]",
					pinned: true,
					forked: true,
					scheduled: true,
					running: true,
				})}
			/>,
		);

		const icons = view.container.querySelectorAll('[data-session-leading-icon="true"]');
		expect(icons).toHaveLength(1);
		expect(icons[0]?.className).toContain("icon-[solar--refresh-linear]");
	});

	it("keeps status icons on the left and grouped avatars on the right", () => {
		const view = render(
			<DefaultSessionRowView
				{...props({
					trailingAvatarUrls: ["/avatar.webp"],
					running: true,
				})}
			/>,
		);

		expect(view.container.querySelector('[data-avatar-stack="true"]')?.querySelectorAll("img")).toHaveLength(1);
		expect(view.container.querySelector('[data-session-leading-icon="true"]')?.className).toContain(
			"icon-[solar--refresh-linear]",
		);
	});

	it("bounds a large avatar collection to three faces and one overflow marker", () => {
		const avatarUrls = Array.from({ length: 32 }, (_, index) => `/avatar-${index}.webp`);
		const view = render(<DefaultSessionRowView {...props({ trailingAvatarUrls: avatarUrls })} />);

		const stack = view.container.querySelector('[data-avatar-stack="true"]');
		expect(stack?.querySelectorAll("img")).toHaveLength(3);
		expect(stack?.textContent).toBe("+29");
		expect(stack?.querySelector('[data-avatar-overflow="29"]')).not.toBeNull();
		expect(view.container.querySelector('[data-session-leading-icon="true"]')?.className).toContain(
			"icon-[solar--chat-round-line-linear]",
		);
	});

	it("falls back to the source icon when no avatars are available", () => {
		const view = render(
			<DefaultSessionRowView
				{...props({
					iconClassName: "icon-[solar--users-group-rounded-linear]",
					trailingAvatarUrls: [],
				})}
			/>,
		);

		expect(view.container.querySelector('[data-avatar-stack="true"]')).toBeNull();
		expect(view.container.querySelector('[data-session-leading-icon="true"]')?.className).toContain(
			"icon-[solar--users-group-rounded-linear]",
		);
	});

	it.each([1, 3])("renders all avatars without an overflow marker for %i members", (count) => {
		const avatarUrls = Array.from({ length: count }, (_, index) => `/avatar-${index}.webp`);
		const view = render(<DefaultSessionRowView {...props({ trailingAvatarUrls: avatarUrls })} />);
		const stack = view.container.querySelector('[data-avatar-stack="true"]');

		expect(stack?.querySelectorAll("img")).toHaveLength(count);
		expect(stack?.textContent).toBe("");
	});
});

describe("DefaultSessionRowView tag dots", () => {
	function dots(container: HTMLElement): HTMLElement | null {
		return container.querySelector("[data-session-tag-dots]");
	}

	it("replaces the leading icon with one color dot for a single tag", () => {
		const view = render(<DefaultSessionRowView {...props({ tagColors: ["#ff5f57"] })} />);

		expect(view.container.querySelector('[data-session-leading-icon="true"]')).toBeNull();
		expect(dots(view.container)?.getAttribute("data-session-tag-dots")).toBe("1");
		expect(dots(view.container)?.querySelectorAll("span")).toHaveLength(1);
	});

	it.each([2, 3])("stacks %i tags inside the icon-sized slot", (count) => {
		const colors = ["#ff5f57", "#0a84ff", "#32d74b"].slice(0, count);
		const view = render(<DefaultSessionRowView {...props({ tagColors: colors })} />);

		const group = dots(view.container);
		expect(group?.querySelectorAll("span")).toHaveLength(count);
		// 文字左对齐的前提：色点组与图标同宽，色点只在盒内铺开。
		expect(group?.className).toContain("w-3.5");
	});

	it("lays four tags out as a static 2×2 grid", () => {
		const colors = ["#ff5f57", "#ff9f0a", "#ffd60a", "#32d74b"];
		const view = render(<DefaultSessionRowView {...props({ tagColors: colors })} />);

		const group = dots(view.container);
		expect(group?.querySelectorAll("span")).toHaveLength(4);
		expect(group?.querySelector("[data-tag-dot-cycling]")).toBeNull();
	});

	it("keeps the 2×2 grid beyond four tags and cycles the fourth dot through the rest", () => {
		vi.useFakeTimers();
		try {
			const colors = ["#ff5f57", "#ff9f0a", "#ffd60a", "#32d74b", "#0a84ff"];
			const view = render(<DefaultSessionRowView {...props({ tagColors: colors })} />);
			const cycling = (): HTMLElement | null => view.container.querySelector("[data-tag-dot-cycling]");

			expect(dots(view.container)?.querySelectorAll("span")).toHaveLength(4);
			const first = cycling()?.style.backgroundColor;
			act(() => {
				vi.advanceTimersByTime(1600);
			});

			expect(cycling()?.style.backgroundColor).not.toBe(first);
		} finally {
			vi.useRealTimers();
		}
	});

	it("yields the slot back to the running indicator while the conversation streams", () => {
		const view = render(<DefaultSessionRowView {...props({ running: true, tagColors: ["#ff5f57"] })} />);

		expect(dots(view.container)).toBeNull();
		expect(view.container.querySelector('[data-session-leading-icon="true"]')?.className).toContain(
			"icon-[solar--refresh-linear]",
		);
	});
});

describe("SessionRowView Team identity", () => {
	it("forwards the context-menu gesture from a Team conversation inside a project", () => {
		const onOpenContextMenu = vi.fn();
		const view = render(
			<SessionRowView
				active={false}
				iconClassName="icon-[solar--users-group-rounded-linear]"
				label="Team task"
				onOpenContextMenu={onOpenContextMenu}
				onRename={vi.fn()}
				onRenameDone={vi.fn()}
				onSelect={vi.fn()}
				renaming={false}
				running={false}
				scheduled={false}
			/>,
		);

		fireEvent.contextMenu(view.getByRole("button", { name: "Team task" }), {
			clientX: 48,
			clientY: 72,
		});

		expect(onOpenContextMenu).toHaveBeenCalledOnce();
	});

	it("keeps the ordinary status icon inside the row-owned project indentation", () => {
		const view = render(
			<SessionRowView
				active={false}
				label="Conversation"
				onOpenContextMenu={vi.fn()}
				onRename={vi.fn()}
				onRenameDone={vi.fn()}
				onSelect={vi.fn()}
				renaming={false}
				running={false}
				scheduled={false}
			/>,
		);

		expect(view.getByRole("button").className).toContain("pl-[30px]");
		expect(view.container.querySelector('[data-session-leading-icon="true"]')?.className).not.toContain(
			"ml-[20px]",
		);
	});

	it("renders the Agent Team icon before the task title and member avatars at the trailing edge", () => {
		const view = render(
			<SessionRowView
				active={false}
				iconClassName="icon-[solar--users-group-rounded-linear]"
				label="Review deployment plan"
				trailingAvatarUrls={["/master.webp", "/architect.webp", "/executor.webp"]}
				onOpenContextMenu={vi.fn()}
				onRename={vi.fn()}
				onRenameDone={vi.fn()}
				onSelect={vi.fn()}
				renaming={false}
				running={false}
				scheduled={false}
			/>,
		);

		expect(view.getByText("Review deployment plan")).toBeTruthy();
		expect(view.getByRole("button").className).toContain("pl-[30px]");
		expect(view.queryByText("Dev Team")).toBeNull();
		expect(view.queryByText("now")).toBeNull();
		expect(view.container.querySelector('[data-session-leading-icon="true"]')?.className).toContain(
			"icon-[solar--users-group-rounded-linear]",
		);
		expect(view.container.querySelector('[data-avatar-stack="true"]')?.querySelectorAll("img")).toHaveLength(3);
	});

	it("replaces the Agent Team icon with the running spinner without moving member avatars", () => {
		const view = render(
			<SessionRowView
				active={false}
				iconClassName="icon-[solar--users-group-rounded-linear]"
				label="Review deployment plan"
				trailingAvatarUrls={["/master.webp", "/executor.webp"]}
				onOpenContextMenu={vi.fn()}
				onRename={vi.fn()}
				onRenameDone={vi.fn()}
				onSelect={vi.fn()}
				renaming={false}
				running={true}
				scheduled={false}
			/>,
		);

		expect(view.container.querySelector('[data-session-leading-icon="true"]')?.className).toContain(
			"icon-[solar--refresh-linear]",
		);
		expect(view.container.querySelector('[data-session-leading-icon="true"]')?.className).toContain("animate-spin");
		expect(view.container.querySelector('[data-avatar-stack="true"]')?.querySelectorAll("img")).toHaveLength(2);
	});
});
