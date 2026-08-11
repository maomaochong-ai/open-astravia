// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { NodeProps } from "@xyflow/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentNodeCard, type ContentFlowNode, type ContentFlowNodeData } from "../src/node/ContentNodeCard";

const editorRender = vi.hoisted(() => vi.fn());
const surfaceRender = vi.hoisted(() => vi.fn());
const nodeDefinition = vi.hoisted(() => ({
	category: "generation",
	descriptionKey: "node.description.image-generator",
	inputs: [],
	outputs: [],
	properties: [{ key: "prompt" }],
}));

interface MockButtonProps extends ComponentProps<"button"> {
	size?: string;
	variant?: string;
}

vi.mock("@xyflow/react", () => ({
	NodeResizer: () => null,
	NodeToolbar: ({ children, isVisible }: { children: ReactNode; isVisible?: boolean }) =>
		isVisible ? <div>{children}</div> : null,
	Position: { Bottom: "bottom", Left: "left", Right: "right", Top: "top" },
}));

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@vetta/ui", () => ({
	Button: ({ children, size: _size, variant: _variant, ...props }: MockButtonProps) => (
		<button {...props}>{children}</button>
	),
}));

vi.mock("../src/canvas/ContentCanvasSelectionContext", () => ({
	useContentCanvasSelectionCount: () => 1,
}));

vi.mock("../src/node/definitions", () => ({
	getContentNodeDefinition: () => nodeDefinition,
}));

vi.mock("../src/node/ContentNodeEditor", () => ({
	ContentNodeEditor: () => {
		editorRender();
		return <div data-testid="content-node-editor" />;
	},
}));

vi.mock("../src/node/ContentNodeHandle", () => ({
	ContentNodeHandle: () => null,
}));

vi.mock("../src/node/ContentNodeHeader", () => ({
	ContentNodeHeader: () => null,
}));

vi.mock("../src/node/ContentNodeSurface", async () => {
	const { memo } = await import("react");
	return {
		ContentNodeSurface: memo(() => {
			surfaceRender();
			return null;
		}),
	};
});

function createNodeData(): ContentFlowNodeData {
	return {
		kind: "image-generator",
		name: "Image generator",
		nodeData: { prompt: "" },
		assets: [],
		connectedAssets: [],
		connectedPrompts: [],
		mentionAssets: [],
		status: "idle",
		locked: false,
		models: [],
		referenceAssets: [],
		onDelete: vi.fn(),
		onDuplicate: vi.fn(),
		onToggleLock: vi.fn(),
		onRename: vi.fn().mockResolvedValue(undefined),
		onUpdate: vi.fn().mockResolvedValue(undefined),
		onResize: vi.fn(),
		onRunNode: vi.fn().mockResolvedValue(undefined),
		onImportAssets: vi.fn().mockResolvedValue(undefined),
		onImportReferences: vi.fn().mockResolvedValue(undefined),
	};
}

function createNodeProps(
	data: ContentFlowNodeData,
	overrides: Partial<NodeProps<ContentFlowNode>> = {},
): NodeProps<ContentFlowNode> {
	return {
		id: "image-node",
		data,
		type: "contentNode",
		dragging: false,
		zIndex: 1,
		selectable: true,
		deletable: true,
		selected: true,
		draggable: true,
		isConnectable: true,
		positionAbsoluteX: 0,
		positionAbsoluteY: 0,
		...overrides,
	};
}

describe("ContentNodeCard render boundary", () => {
	afterEach(() => {
		cleanup();
		editorRender.mockClear();
		surfaceRender.mockClear();
	});

	it("does not rerender the editor when only the React Flow position changes", async () => {
		const data = createNodeData();
		const props = createNodeProps(data);
		const view = render(<ContentNodeCard {...props} />);

		await waitFor(() => expect(editorRender).toHaveBeenCalledTimes(1));

		view.rerender(
			<ContentNodeCard
				{...props}
				positionAbsoluteX={120}
				positionAbsoluteY={80}
			/>,
		);

		expect(editorRender).toHaveBeenCalledTimes(1);

		view.rerender(<ContentNodeCard {...props} data={{ ...data, name: "Updated name" }} />);

		expect(editorRender).toHaveBeenCalledTimes(2);
	});

	it("keeps the node surface stable across selection chrome updates", () => {
		const data = createNodeData();
		const props = createNodeProps(data);
		const view = render(<ContentNodeCard {...props} />);

		expect(surfaceRender).toHaveBeenCalledTimes(1);

		view.rerender(<ContentNodeCard {...props} dragging />);
		view.rerender(<ContentNodeCard {...props} dragging={false} />);

		expect(surfaceRender).toHaveBeenCalledTimes(1);
	});

	it("mounts an unselected node editor only after dragging stops", async () => {
		const data = createNodeData();
		const props = createNodeProps(data, { selected: false });
		const view = render(<ContentNodeCard {...props} />);

		expect(editorRender).not.toHaveBeenCalled();

		view.rerender(<ContentNodeCard {...props} selected dragging />);
		view.rerender(
			<ContentNodeCard
				{...props}
				selected
				dragging
				positionAbsoluteX={120}
				positionAbsoluteY={80}
			/>,
		);

		expect(editorRender).not.toHaveBeenCalled();

		view.rerender(<ContentNodeCard {...props} selected dragging={false} />);

		await waitFor(() => expect(editorRender).toHaveBeenCalledTimes(1));
	});

	it("keeps an existing editor mounted but hidden while dragging", async () => {
		const data = createNodeData();
		const props = createNodeProps(data);
		const view = render(<ContentNodeCard {...props} />);

		await waitFor(() => expect(editorRender).toHaveBeenCalledTimes(1));

		view.rerender(<ContentNodeCard {...props} dragging />);

		expect(editorRender).toHaveBeenCalledTimes(1);
		expect(screen.getByTestId("content-node-editor").parentElement?.classList.contains("invisible")).toBe(true);

		view.rerender(<ContentNodeCard {...props} dragging={false} />);

		expect(editorRender).toHaveBeenCalledTimes(1);
		expect(screen.getByTestId("content-node-editor").parentElement?.classList.contains("invisible")).toBe(false);
	});
});
