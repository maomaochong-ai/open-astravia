// @vitest-environment jsdom

import type { FileExplorerEntry, FileTreeViewProps } from "@vetta-org/theme-ui/file-explorer";
import { FileTreeView } from "@vetta-org/theme-ui/file-explorer";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockVirtuosoProps = {
	readonly data: readonly { readonly key: string }[];
	readonly itemContent: (index: number, row: { readonly key: string }) => ReactNode;
	readonly computeItemKey: (index: number, row: { readonly key: string }) => string;
	readonly itemSize?: (el: HTMLElement, field: "offsetHeight" | "offsetWidth") => number;
	readonly scrollerRef?: (ref: HTMLElement | Window | null) => void;
	readonly rangeChanged?: (range: { startIndex: number; endIndex: number }) => void;
};

/**
 * Stand-in for react-virtuoso: mounts only `[start, end]` of `data` (like overscan
 * recycling) and stamps wrappers the way Virtuoso does so `itemSize` can be exercised.
 */
const virtuoso = vi.hoisted(() => ({
	scrollIntoView: vi.fn(),
	props: null as MockVirtuosoProps | null,
	setWindow: null as ((next: [number, number] | null) => void) | null,
}));

vi.mock("react-virtuoso", async () => {
	const React = await import("react");
	return {
		Virtuoso: React.forwardRef(function VirtuosoMock(props: MockVirtuosoProps, ref) {
			const [window, setWindow] = React.useState<[number, number] | null>(null);
			virtuoso.props = props;
			virtuoso.setWindow = setWindow;
			React.useImperativeHandle(ref, () => ({ scrollIntoView: virtuoso.scrollIntoView, scrollToIndex: vi.fn() }));
			const [start, end] = window ?? [0, props.data.length - 1];
			return (
				<div
					data-testid="virtuoso-scroller"
					ref={(el) => {
						props.scrollerRef?.(el);
					}}
				>
					{props.data.slice(start, end + 1).map((row, offset) => {
						const index = start + offset;
						return (
							<div key={props.computeItemKey(index, row)} data-item-index={index} data-known-size="24">
								{props.itemContent(index, row)}
							</div>
						);
					})}
				</div>
			);
		}),
	};
});

function file(path: string): FileExplorerEntry {
	return { name: path.slice(path.lastIndexOf("/") + 1), path, isDirectory: false, size: 1, modifiedAt: 0 };
}

function makeProps(overrides: Partial<FileTreeViewProps> = {}): FileTreeViewProps {
	return {
		rootDir: "/proj",
		cache: new Map([["/proj", Array.from({ length: 200 }, (_, index) => file(`/proj/f-${index}.ts`))]]),
		expandedDirs: new Set(),
		loadingDirs: new Set(),
		selectedPaths: new Set(),
		focusedPath: null,
		renamingPath: null,
		creatingEntry: null,
		emptyLabel: "empty",
		createInputLabel: "name",
		onToggleDir: vi.fn(),
		onSelectEntry: vi.fn(),
		onSelectPaths: vi.fn(),
		onBackgroundClick: vi.fn(),
		onContextMenu: vi.fn(),
		onRootContextMenu: vi.fn(),
		onRenameSubmit: vi.fn(),
		onRenameCancel: vi.fn(),
		onCreateSubmit: vi.fn(),
		onCreateCancel: vi.fn(),
		onFileMove: vi.fn(),
		onExternalDrop: vi.fn(),
		onNativeDragStart: vi.fn(),
		...overrides,
	};
}

/** Simulate Virtuoso's ResizeObserver pass: every mounted wrapper reports `height` px. */
function measureMountedRows(height: number): void {
	const itemSize = virtuoso.props?.itemSize;
	if (!itemSize) throw new Error("FileTreeView did not pass itemSize to Virtuoso");
	for (const wrapper of screen.getByTestId("virtuoso-scroller").querySelectorAll<HTMLElement>("[data-item-index]")) {
		wrapper.getBoundingClientRect = () => ({ height, width: 200 }) as DOMRect;
		itemSize(wrapper, "offsetHeight");
	}
}

function mountWindow(range: [number, number] | null): void {
	act(() => {
		virtuoso.setWindow?.(range);
	});
}

beforeEach(() => {
	virtuoso.scrollIntoView.mockReset();
	virtuoso.props = null;
	virtuoso.setWindow = null;
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("FileTreeView marquee selection", () => {
	it("用户在第 100 行附近拖出框选时，按实测行高命中而不是按估计常量", () => {
		const onSelectPaths = vi.fn();
		render(<FileTreeView {...makeProps({ onSelectPaths })} />);
		// Only the first screen is mounted and measured; the marquee lands far below it.
		mountWindow([0, 20]);
		measureMountedRows(24);

		const scroller = screen.getByTestId("virtuoso-scroller");
		fireEvent.mouseDown(scroller, { button: 0, clientX: 4, clientY: 24 * 100 + 2 });
		fireEvent.mouseMove(window, { clientX: 80, clientY: 24 * 100 + 20 });
		fireEvent.mouseUp(window);

		expect(onSelectPaths).toHaveBeenLastCalledWith(["/proj/f-100.ts"]);
	});

	it("行被折叠后重新测量不会让旧高度残留在几何命中里", () => {
		const onSelectPaths = vi.fn();
		const props = makeProps({ onSelectPaths });
		const { rerender } = render(<FileTreeView {...props} />);
		mountWindow([0, 10]);
		measureMountedRows(40);

		// Every row disappears (directory refreshed to a new listing) and comes back at 24px.
		rerender(<FileTreeView {...props} cache={new Map([["/proj", [file("/proj/x.ts"), file("/proj/y.ts")]]])} />);
		mountWindow(null);
		measureMountedRows(24);

		const scroller = screen.getByTestId("virtuoso-scroller");
		fireEvent.mouseDown(scroller, { button: 0, clientX: 4, clientY: 26 });
		fireEvent.mouseMove(window, { clientX: 80, clientY: 46 });
		fireEvent.mouseUp(window);

		expect(onSelectPaths).toHaveBeenLastCalledWith(["/proj/y.ts"]);
	});
});
