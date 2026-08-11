// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContentProject } from "../src/project/types";
import { GraphWorkspace } from "../src/canvas/GraphWorkspace";

const reactFlowCapture = vi.hoisted(() => ({
	props: null as Record<string, unknown> | null,
}));
const projectMenuCapture = vi.hoisted(() => ({
	props: null as Record<string, unknown> | null,
}));
const shortcutScopeCapture = vi.hoisted(() => ({
	options: [] as Record<string, unknown>[],
}));

vi.mock("@xyflow/react", () => ({
	Controls: ({ children }: { children?: unknown }) => <>{children}</>,
	ControlButton: ({ children }: { children?: unknown }) => <button type="button">{children}</button>,
	useStore: (
		selector: (state: {
			transform: [number, number, number];
			minZoom: number;
			maxZoom: number;
		}) => unknown,
	) => selector({ transform: [0, 0, 1], minZoom: 0.1, maxZoom: 4 }),
	useReactFlow: () => ({
		zoomTo: vi.fn(),
		zoomIn: vi.fn(),
		zoomOut: vi.fn(),
		fitView: vi.fn(),
	}),
	SelectionMode: { Partial: "partial" },
	ReactFlow: (props: Record<string, unknown>) => {
		reactFlowCapture.props = props;
		return <div>{props.children as never}</div>;
	},
}));

vi.mock("@vetta-org/plugin-sdk", () => ({
	usePluginShortcutScope: (_register: unknown, options: Record<string, unknown>) => {
		shortcutScopeCapture.options.push(options);
	},
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../src/node/ContentNodeCard", () => ({
	ContentNodeCard: () => null,
}));

vi.mock("../src/canvas/AlignmentGuidesLayer", () => ({
	AlignmentGuidesLayer: () => null,
}));

vi.mock("../src/canvas/GraphOverlayLayer", () => ({
	GraphOverlayLayer: () => null,
}));

vi.mock("../src/canvas/SelectionToolbar", () => ({
	SelectionToolbar: () => null,
}));

vi.mock("../src/canvas/CanvasProjectMenu", () => ({
	CanvasProjectMenu: (props: Record<string, unknown>) => {
		projectMenuCapture.props = props;
		return null;
	},
}));

describe("GraphWorkspace mouse interactions", () => {
	beforeEach(() => {
		reactFlowCapture.props = null;
		projectMenuCapture.props = null;
		shortcutScopeCapture.options = [];
	});
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("uses primary-button drag for canvas panning and Control-drag for box selection", () => {
		renderToStaticMarkup(
			<GraphWorkspace
				project={createContentProject("C:\\project")}
				assetPreviewUrls={new Map()}
				models={[]}
				onDispatch={async () => undefined}
				onRunNode={async () => undefined}
				onImportAssets={async () => undefined}
				onImportReferences={async () => undefined}
				onSelectedNodeIdsChange={() => undefined}
				onOpenSettings={() => undefined}
			/>,
		);

		expect(reactFlowCapture.props?.selectionOnDrag).toBe(false);
		expect(reactFlowCapture.props?.selectionKeyCode).toBe("Control");
		expect(reactFlowCapture.props?.selectionMode).toBe("partial");
		expect(reactFlowCapture.props?.panOnDrag).toBe(true);
		expect(reactFlowCapture.props?.minZoom).toBe(0.1);
		expect(reactFlowCapture.props?.maxZoom).toBe(4);
	});

	it("applies an injected viewport range and uses its default zoom for reset", () => {
		renderToStaticMarkup(
			<GraphWorkspace
				project={createContentProject("C:\\project")}
				assetPreviewUrls={new Map()}
				models={[]}
				onDispatch={async () => undefined}
				onRunNode={async () => undefined}
				onImportAssets={async () => undefined}
				onImportReferences={async () => undefined}
				onSelectedNodeIdsChange={() => undefined}
				onOpenSettings={() => undefined}
				viewportConfig={{ minZoom: 0.2, maxZoom: 3, defaultZoom: 1.25 }}
			/>,
		);

		expect(reactFlowCapture.props?.minZoom).toBe(0.2);
		expect(reactFlowCapture.props?.maxZoom).toBe(3);
		expect(reactFlowCapture.props?.fitView).toBeUndefined();
		expect(reactFlowCapture.props?.defaultViewport).toEqual({ x: 0, y: 0, zoom: 1.25 });

		const zoomTo = vi.fn().mockResolvedValue(true);
		const setViewport = vi.fn().mockResolvedValue(true);
		(reactFlowCapture.props?.onInit as (instance: Record<string, unknown>) => void)({
			setNodes: vi.fn(),
			setEdges: vi.fn(),
			zoomTo,
			setViewport,
			fitView: vi.fn(),
		});
		// Empty project opens at default zoom without auto-fitting scale.
		expect(setViewport).toHaveBeenCalledWith({ x: 0, y: 0, zoom: 1.25 });
		(projectMenuCapture.props?.onResetZoom as () => void)();

		expect(zoomTo).toHaveBeenCalledWith(1.25, { duration: 180 });
	});

	it("centers existing nodes at default zoom on init without auto-scaling", () => {
		const project = createContentProject("C:\\project");
		project.graph.nodes.push({
			id: "n1",
			kind: "prompt",
			position: { x: 120, y: 80 },
			status: "idle",
			data: {},
		});

		renderToStaticMarkup(
			<GraphWorkspace
				project={project}
				assetPreviewUrls={new Map()}
				models={[]}
				onDispatch={async () => undefined}
				onRunNode={async () => undefined}
				onImportAssets={async () => undefined}
				onImportReferences={async () => undefined}
				onSelectedNodeIdsChange={() => undefined}
				onOpenSettings={() => undefined}
			/>,
		);

		const fitView = vi.fn().mockResolvedValue(true);
		(reactFlowCapture.props?.onInit as (instance: Record<string, unknown>) => void)({
			setNodes: vi.fn(),
			setEdges: vi.fn(),
			setViewport: vi.fn(),
			fitView,
		});

		expect(fitView).toHaveBeenCalledWith({ minZoom: 1, maxZoom: 1, padding: 0.16 });
	});

	it("hydrates current asset previews when React Flow initializes after preview resolution", () => {
		const project = createContentProject("C:\\project");
		const assetId = "generated-image";
		const previewUrl = "vetta-media://local/generated-image";
		project.assets = [
			{
				id: assetId,
				blobId: "generated-image-blob",
				kind: "image",
				name: "Generated image",
				mimeType: "image/png",
				createdAt: "2026-08-07T00:00:00.000Z",
			},
		];
		project.graph.nodes = [
			{
				id: "asset-node",
				kind: "asset",
				position: { x: 0, y: 0 },
				status: "idle",
				data: { assetIds: [assetId] },
			},
			{
				id: "image-node",
				kind: "image-generator",
				position: { x: 420, y: 0 },
				status: "succeeded",
				data: { assetId },
			},
		];

		renderToStaticMarkup(
			<GraphWorkspace
				project={project}
				assetPreviewUrls={new Map([[assetId, previewUrl]])}
				models={[]}
				onDispatch={async () => undefined}
				onRunNode={async () => undefined}
				onImportAssets={async () => undefined}
				onImportReferences={async () => undefined}
				onSelectedNodeIdsChange={() => undefined}
				onOpenSettings={() => undefined}
			/>,
		);

		const onInit = reactFlowCapture.props?.onInit;
		const setNodes = vi.fn();
		const setEdges = vi.fn();
		expect(typeof onInit).toBe("function");
		(onInit as (instance: { setNodes: typeof setNodes; setEdges: typeof setEdges }) => void)({
			setNodes,
			setEdges,
			fitView: vi.fn(),
			setViewport: vi.fn(),
		} as never);

		expect(setNodes).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					id: "asset-node",
					data: expect.objectContaining({
						assets: [expect.objectContaining({ id: assetId, previewUrl })],
					}),
				}),
				expect.objectContaining({
					id: "image-node",
					data: expect.objectContaining({ assetUrl: previewUrl }),
				}),
			]),
		);
	});

	it("routes project menu view actions through the current React Flow instance", () => {
		const project = createContentProject("C:\\project");
		project.graph.nodes = [
			{ id: "first", kind: "prompt", position: { x: 0, y: 0 }, status: "idle", data: {} },
			{ id: "second", kind: "image-generator", position: { x: 400, y: 0 }, status: "running", data: {} },
		];
		const onOpenSettings = vi.fn();
		renderToStaticMarkup(
			<GraphWorkspace
				project={project}
				assetPreviewUrls={new Map()}
				models={[]}
				onDispatch={async () => undefined}
				onRunNode={async () => undefined}
				onImportAssets={async () => undefined}
				onImportReferences={async () => undefined}
				onSelectedNodeIdsChange={() => undefined}
				onOpenSettings={onOpenSettings}
			/>,
		);

		const flowNodes = [{ id: "first" }, { id: "second" }];
		const fitView = vi.fn().mockResolvedValue(true);
		const zoomTo = vi.fn().mockResolvedValue(true);
		(reactFlowCapture.props?.onInit as (instance: Record<string, unknown>) => void)({
			setNodes: vi.fn(),
			setEdges: vi.fn(),
			getNodes: () => flowNodes,
			fitView,
			zoomTo,
		});

		(projectMenuCapture.props?.onFitContent as () => void)();
		expect(fitView).toHaveBeenLastCalledWith({ duration: 240, padding: 0.16 });

		(projectMenuCapture.props?.onFocusNodes as (nodeIds: readonly string[]) => void)(["second"]);
		expect(fitView).toHaveBeenLastCalledWith({ nodes: [flowNodes[1]], duration: 240, padding: 0.28 });

		(projectMenuCapture.props?.onResetZoom as () => void)();
		expect(zoomTo).toHaveBeenCalledWith(1, { duration: 180 });

		(projectMenuCapture.props?.onOpenSettings as () => void)();
		expect(onOpenSettings).toHaveBeenCalledOnce();
	});

	it("registers mod+a and selects every React Flow node while the canvas surface is visible", async () => {
		const project = createContentProject("C:\\project");
		project.graph.nodes = [
			{ id: "first", kind: "prompt", position: { x: 0, y: 0 }, status: "idle", data: {} },
			{
				id: "locked",
				kind: "image-generator",
				position: { x: 400, y: 0 },
				locked: true,
				status: "idle",
				data: {},
			},
		];
		const visibleRects = [{ width: 900, height: 600 }] as unknown as DOMRectList;
		const rects = vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue(visibleRects);
		const onSelectedNodeIdsChange = vi.fn();
		render(
			<GraphWorkspace
				project={project}
				assetPreviewUrls={new Map()}
				models={[]}
				onDispatch={async () => undefined}
				onRunNode={async () => undefined}
				onImportAssets={async () => undefined}
				onImportReferences={async () => undefined}
				onSelectedNodeIdsChange={onSelectedNodeIdsChange}
				onOpenSettings={() => undefined}
			/>,
		);

		let flowNodes: Array<{ id: string; selected?: boolean }> = [];
		const setNodes = vi.fn((next: typeof flowNodes | ((nodes: typeof flowNodes) => typeof flowNodes)) => {
			flowNodes = typeof next === "function" ? next(flowNodes) : next;
		});
		act(() => {
			(reactFlowCapture.props?.onInit as (instance: Record<string, unknown>) => void)({
				setNodes,
				setEdges: vi.fn(),
				fitView: vi.fn(),
				setViewport: vi.fn(),
			});
		});

		const selectAllScope = shortcutScopeCapture.options.find((options) => options.id === "graph-select-all");
		expect(selectAllScope).toBeDefined();
		expect((selectAllScope?.enabled as () => boolean)()).toBe(true);
		const binding = (selectAllScope?.bindings as Array<Record<string, unknown>>)[0];
		expect(binding).toMatchObject({ key: "mod+a", when: "not-editable" });

		act(() => {
			(binding?.run as (event: KeyboardEvent) => void)({} as KeyboardEvent);
		});

		expect(flowNodes.map((node) => ({ id: node.id, selected: node.selected }))).toEqual([
			{ id: "first", selected: true },
			{ id: "locked", selected: true },
		]);
		await waitFor(() => expect(onSelectedNodeIdsChange).toHaveBeenLastCalledWith(["first", "locked"]));

		rects.mockReturnValue([] as unknown as DOMRectList);
		expect((selectAllScope?.enabled as () => boolean)()).toBe(false);
	});

	it("commits box selection once after the drag instead of rebuilding nodes on every move", async () => {
		const project = createContentProject("C:\\project");
		project.graph.nodes = [
			{ id: "first", kind: "prompt", position: { x: 0, y: 0 }, status: "idle", data: {} },
			{ id: "second", kind: "image-generator", position: { x: 400, y: 0 }, status: "idle", data: {} },
		];
		const onSelectedNodeIdsChange = vi.fn();
		render(
			<GraphWorkspace
				project={project}
				assetPreviewUrls={new Map()}
				models={[]}
				onDispatch={async () => undefined}
				onRunNode={async () => undefined}
				onImportAssets={async () => undefined}
				onImportReferences={async () => undefined}
				onSelectedNodeIdsChange={onSelectedNodeIdsChange}
				onOpenSettings={() => undefined}
			/>,
		);

		let flowNodes = [
			{ id: "first", selected: false },
			{ id: "second", selected: false },
		];
		const setNodes = vi.fn();
		const setEdges = vi.fn();
		act(() => {
			(reactFlowCapture.props?.onInit as (instance: Record<string, unknown>) => void)({
				setNodes,
				setEdges,
				getNodes: () => flowNodes,
				fitView: vi.fn(),
				setViewport: vi.fn(),
			});
		});
		await waitFor(() => expect(onSelectedNodeIdsChange).toHaveBeenCalledWith([]));
		onSelectedNodeIdsChange.mockClear();
		setNodes.mockClear();
		setEdges.mockClear();
		const defaultNodes = reactFlowCapture.props?.defaultNodes;

		act(() => {
			(reactFlowCapture.props?.onSelectionStart as () => void)();
			(reactFlowCapture.props?.onSelectionChange as (selection: Record<string, unknown>) => void)({
				nodes: [{ id: "first" }],
			});
			(reactFlowCapture.props?.onSelectionChange as (selection: Record<string, unknown>) => void)({
				nodes: [{ id: "first" }, { id: "second" }],
			});
		});

		expect(onSelectedNodeIdsChange).not.toHaveBeenCalled();
		expect(setNodes).not.toHaveBeenCalled();
		expect(setEdges).not.toHaveBeenCalled();
		expect(reactFlowCapture.props?.defaultNodes).toBe(defaultNodes);

		flowNodes = [
			{ id: "first", selected: true },
			{ id: "second", selected: true },
		];
		act(() => {
			(reactFlowCapture.props?.onSelectionEnd as () => void)();
		});

		await waitFor(() => expect(onSelectedNodeIdsChange).toHaveBeenCalledTimes(1));
		expect(onSelectedNodeIdsChange).toHaveBeenLastCalledWith(["first", "second"]);
		expect(setNodes).not.toHaveBeenCalled();
		expect(setEdges).toHaveBeenCalledTimes(1);
	});
});
