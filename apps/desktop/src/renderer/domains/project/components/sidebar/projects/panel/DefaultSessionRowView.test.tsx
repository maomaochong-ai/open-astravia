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
});
