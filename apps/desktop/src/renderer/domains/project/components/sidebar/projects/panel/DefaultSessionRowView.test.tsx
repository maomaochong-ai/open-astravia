// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { DefaultSessionRowView, type DefaultSessionRowViewProps } from "@vetta/theme-ui/project";
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
		timeLabel: "",
		onOpenContextMenu: vi.fn(),
		onRename: vi.fn(),
		onRenameDone: vi.fn(),
		onSelect: vi.fn(),
		...overrides,
	};
}

describe("DefaultSessionRowView leading icon", () => {
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

	it("keeps status icons visible when avatar data is also provided", () => {
		const view = render(
			<DefaultSessionRowView
				{...props({
					leadingAvatarUrls: ["/avatar.webp"],
					running: true,
				})}
			/>,
		);

		expect(view.container.querySelector('[data-session-avatar-stack="true"]')).toBeNull();
		expect(view.container.querySelector('[data-session-leading-icon="true"]')?.className).toContain(
			"icon-[solar--refresh-linear]",
		);
	});

	it("bounds a large avatar collection to three faces and one overflow marker", () => {
		const avatarUrls = Array.from({ length: 32 }, (_, index) => `/avatar-${index}.webp`);
		const view = render(<DefaultSessionRowView {...props({ leadingAvatarUrls: avatarUrls })} />);

		const stack = view.container.querySelector('[data-session-avatar-stack="true"]');
		expect(stack?.querySelectorAll("img")).toHaveLength(3);
		expect(stack?.textContent).toBe("+29");
		expect(stack?.querySelector('[data-session-avatar-overflow="29"]')).not.toBeNull();
		expect(view.container.querySelector('[data-session-leading-icon="true"]')).toBeNull();
	});

	it("falls back to the source icon when no avatars are available", () => {
		const view = render(
			<DefaultSessionRowView
				{...props({
					iconClassName: "icon-[solar--users-group-rounded-linear]",
					leadingAvatarUrls: [],
				})}
			/>,
		);

		expect(view.container.querySelector('[data-session-avatar-stack="true"]')).toBeNull();
		expect(view.container.querySelector('[data-session-leading-icon="true"]')?.className).toContain(
			"icon-[solar--users-group-rounded-linear]",
		);
	});

	it.each([1, 3])("renders all avatars without an overflow marker for %i members", (count) => {
		const avatarUrls = Array.from({ length: count }, (_, index) => `/avatar-${index}.webp`);
		const view = render(<DefaultSessionRowView {...props({ leadingAvatarUrls: avatarUrls })} />);
		const stack = view.container.querySelector('[data-session-avatar-stack="true"]');

		expect(stack?.querySelectorAll("img")).toHaveLength(count);
		expect(stack?.textContent).toBe("");
	});
});
