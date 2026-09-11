// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
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
