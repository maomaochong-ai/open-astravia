// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FileContextMenuView, type FileContextMenuViewProps } from "@vetta-org/theme-ui/file-explorer";

const noop = (): void => {};
const props: FileContextMenuViewProps = {
	x: 0,
	y: 0,
	labels: {
		newFile: "New file",
		newFolder: "New folder",
		openInFolder: "Show in Finder",
		copy: "Copy",
		paste: "Paste",
		copyPath: "Copy path",
		copyName: "Copy name",
		rename: "Rename",
		delete: "Delete",
	},
	onClose: noop,
	onCreateFile: noop,
	onCreateFolder: noop,
	onOpenInFolder: noop,
	onCopy: noop,
	onPaste: noop,
	onCopyPath: noop,
	onCopyName: noop,
	onRename: noop,
	onDelete: noop,
	showEntryActions: true,
	canPaste: false,
	canRename: true,
};

describe("FileContextMenuView", () => {
	it("offers the system file manager by default, as local entries always have", () => {
		render(<FileContextMenuView {...props} />);
		expect(screen.queryByText("Show in Finder")).not.toBeNull();
	});

	it("hides it for an entry with no counterpart on this computer, keeping the rest of the menu", () => {
		// 远程项目里的文件：系统文件管理器无从显示，点了只会毫无反应。
		render(<FileContextMenuView {...props} canOpenInFolder={false} />);
		expect(screen.queryByText("Show in Finder")).toBeNull();
		expect(screen.queryByText("Rename")).not.toBeNull();
		expect(screen.queryByText("New file")).not.toBeNull();
	});
});
