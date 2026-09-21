// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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

const MENU_WIDTH = 180;
const MENU_HEIGHT = 300;

// jsdom 不排版，菜单尺寸得手动喂给组件，否则翻转逻辑量到的永远是 0。
const sizeStubs = [
	{ prop: "offsetWidth", value: MENU_WIDTH },
	{ prop: "offsetHeight", value: MENU_HEIGHT },
] as const;

function stubMenuSize(): () => void {
	const originals = sizeStubs.map(({ prop }) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop));
	for (const { prop, value } of sizeStubs) {
		Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value });
	}
	return () => {
		sizeStubs.forEach(({ prop }, index) => {
			const original = originals[index];
			if (original) Object.defineProperty(HTMLElement.prototype, prop, original);
			else Reflect.deleteProperty(HTMLElement.prototype, prop);
		});
	};
}

function setViewport(width: number, height: number): void {
	Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
	Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

let restoreSize: (() => void) | null = null;

afterEach(() => {
	restoreSize?.();
	restoreSize = null;
});

describe("FileContextMenuView 定位", () => {
	it("光标周围放得下时，菜单就贴着光标展开", () => {
		restoreSize = stubMenuSize();
		setViewport(1000, 800);
		render(<FileContextMenuView {...props} x={120} y={140} />);
		const menu = screen.getByTestId("file-context-menu");
		expect(menu.style.left).toBe("120px");
		expect(menu.style.top).toBe("140px");
	});

	it("贴着窗口右下角右键时，菜单翻到光标左上侧而不是溢出窗口", () => {
		restoreSize = stubMenuSize();
		setViewport(1000, 800);
		render(<FileContextMenuView {...props} x={950} y={760} />);
		const menu = screen.getByTestId("file-context-menu");
		expect(menu.style.left).toBe(`${950 - MENU_WIDTH}px`);
		expect(menu.style.top).toBe(`${760 - MENU_HEIGHT}px`);
	});

	it("窗口窄到两侧都放不下时，菜单贴住窗口内边距，保证菜单头部可见", () => {
		restoreSize = stubMenuSize();
		setViewport(100, 100);
		render(<FileContextMenuView {...props} x={90} y={90} />);
		const menu = screen.getByTestId("file-context-menu");
		expect(menu.style.left).toBe("8px");
		expect(menu.style.top).toBe("8px");
	});
});
