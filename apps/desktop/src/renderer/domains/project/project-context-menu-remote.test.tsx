// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProjectContextMenuView, type ProjectContextMenuViewProps } from "@vetta-org/theme-ui/project";

const noop = (): void => {};
const props: ProjectContextMenuViewProps = {
	x: 0,
	y: 0,
	isDefault: false,
	labels: {
		openInFolder: "Show in Finder",
		archiveProject: "Archive",
		removeFromList: "Remove",
		deleteProject: "Delete",
		clearConversation: "Clear conversation",
		clearConversationDisabled: "Nothing to clear",
		clearClaw: "Clear claw",
		clearClawDisabled: "Nothing to clear",
		clawSettings: "Claw settings",
	},
	onArchive: noop,
	onClose: noop,
	onDelete: noop,
	onOpenInFolder: noop,
	onRemove: noop,
};

describe("ProjectContextMenuView", () => {
	it("offers the system file manager by default, as local projects always have", () => {
		render(<ProjectContextMenuView {...props} />);
		expect(screen.queryByText("Show in Finder")).not.toBeNull();
	});

	it("hides it for a project with no counterpart on this computer, keeping the rest of the menu", () => {
		// 远程（SSH）项目：目录在那台机器上，点了只会毫无反应。
		render(<ProjectContextMenuView {...props} canOpenInFolder={false} />);
		expect(screen.queryByText("Show in Finder")).toBeNull();
		expect(screen.queryByText("Archive")).not.toBeNull();
		expect(screen.queryByText("Delete")).not.toBeNull();
	});
});
