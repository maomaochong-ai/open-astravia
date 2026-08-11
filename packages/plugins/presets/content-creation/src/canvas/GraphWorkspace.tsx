import {
	type Connection,
	Controls,
	type Edge,
	type FinalConnectionState,
	type NodeTypes,
	type ReactFlowProps,
	ReactFlow,
	type ReactFlowInstance,
	SelectionMode,
} from "@xyflow/react";
import {
	type PluginShortcutBinding,
	type PluginRegisterShortcutScope,
	usePluginShortcutScope,
	useTranslation,
} from "@vetta-org/plugin-sdk";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findContentAlignmentGuides } from "./alignment-guides";
import { listCompatibleNodeKinds, resolveContentConnection } from "../node/connections";
import type { ContentProjectCommand } from "../project/commands";
import { createDefaultContentNodeData } from "../node/definitions";
import { getContentNodeSize } from "../node/geometry";
import {
	alignContentNodes,
	type ContentNodeAlignment,
	type ContentNodeLayout,
	layoutContentNodes,
} from "../node/layout";
import type { ContentNode, ContentNodeKind, ContentProjectDocument } from "../project/types";
import type {
	ContentModelDescriptor,
	ImportedContentAsset,
	ImportedContentReference,
} from "../generation/types";
import { AlignmentGuidesLayer, type AlignmentGuidesLayerHandle } from "./AlignmentGuidesLayer";
import { clampCanvasOverlayPosition } from "./overlay-position";
import { shouldOpenConnectionCreateMenu } from "./connection-drop-menu";
import { ContentCanvasSelectionProvider } from "./ContentCanvasSelectionContext";
import { ContentNodeCard, type ContentFlowNode } from "../node/ContentNodeCard";
import { createContentProjectSyncKey } from "./flow-sync-key";
import {
	type CanvasContextMenuState,
	type CanvasCreateMenuState,
	GraphOverlayLayer,
	type PendingConnectionMenu,
} from "./GraphOverlayLayer";
import {
	type ContentNodeActions,
	getConnectionPointerPosition,
	getNextClipStart,
	resolveContentFlowConnection,
	toContentFlowEdges,
	toContentFlowNodes,
} from "./graph-flow-adapters";
import { CONTENT_FLOW_SOURCE_HANDLE_ID } from "./flow-handles";
import { reconcileSelectedNodeIds } from "./selection-state";
import { SelectionToolbar } from "./SelectionToolbar";
import { DEFAULT_CANVAS_TOOL, getCanvasInteraction } from "./canvas-tools";
import { collectDroppedMediaFiles, dataTransferHasFiles, importDroppedMediaFiles } from "../node/dropped-media";

const nodeTypes: NodeTypes = { contentNode: ContentNodeCard };
const CREATE_MENU_SIZE = { width: 320, height: 420 };
const CONNECTION_MENU_SIZE = { width: 320, height: 340 };
const CONTEXT_MENU_SIZE = { width: 190, height: 132 };
const DEFAULT_EDGE_OPTIONS = { interactionWidth: 28 };
const PRO_OPTIONS = { hideAttribution: true };

interface GraphWorkspaceProps {
	project: ContentProjectDocument;
	assetPreviewUrls: ReadonlyMap<string, string>;
	models: readonly ContentModelDescriptor[];
	onDispatch: (commands: readonly ContentProjectCommand[]) => Promise<void>;
	onRunNode: (nodeId: string) => Promise<void>;
	onImportAssets: (nodeId: string, files: readonly ImportedContentAsset[]) => Promise<void>;
	onImportReferences: (nodeId: string, files: readonly ImportedContentReference[], slotId?: string) => Promise<void>;
	onSelectedNodeIdsChange: (nodeIds: readonly string[]) => void;
	registerShortcutScope?: PluginRegisterShortcutScope | null;
}

export function GraphWorkspace({
	project,
	assetPreviewUrls,
	models,
	onDispatch,
	onRunNode,
	onImportAssets,
	onImportReferences,
	onSelectedNodeIdsChange,
	registerShortcutScope = null,
}: GraphWorkspaceProps) {
	const { t } = useTranslation();
	const flowContainerRef = useRef<HTMLDivElement>(null);
	const flowInstanceRef = useRef<ReactFlowInstance<ContentFlowNode, Edge> | null>(null);
	const alignmentGuidesLayerRef = useRef<AlignmentGuidesLayerHandle>(null);
	/**
	 * React Flow fires `onPaneClick` on the same mouseup that ends a connection drag.
	 * Without this guard, `closeMenus()` immediately wipes the create-connected-node menu
	 * opened by `onConnectEnd`.
	 */
	const suppressNextPaneClickRef = useRef(false);
	const canvasDropDepthRef = useRef(0);
	const [canvasTool, setCanvasTool] = useState(DEFAULT_CANVAS_TOOL);
	const [canvasDropActive, setCanvasDropActive] = useState(false);
	const [importingCanvasDrop, setImportingCanvasDrop] = useState(false);
	const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
	const [pendingMenu, setPendingMenu] = useState<PendingConnectionMenu | null>(null);
	const [canvasMenu, setCanvasMenu] = useState<CanvasCreateMenuState | null>(null);
	const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null);
	const activeSelectedNodeIds = useMemo(
		() => selectedNodeIds.filter((nodeId) => project.graph.nodes.some((node) => node.id === nodeId)),
		[project.graph.nodes, selectedNodeIds],
	);
	const selectedNodeIdSet = useMemo(() => new Set(activeSelectedNodeIds), [activeSelectedNodeIds]);
	useEffect(() => {
		onSelectedNodeIdsChange(activeSelectedNodeIds);
	}, [activeSelectedNodeIds, onSelectedNodeIdsChange]);
	const canvasInteraction = getCanvasInteraction(canvasTool);
	const projectSyncKey = `${createContentProjectSyncKey(
		{
			projectId: project.projectId,
			revision: project.revision,
			updatedAt: project.updatedAt,
			nodeCount: project.graph.nodes.length,
			edgeCount: project.graph.edges.length,
		},
		models,
	)}\u0000${[...assetPreviewUrls].map(([assetId, url]) => `${assetId}:${url}`).join("\u0001")}`;

	const closeMenus = useCallback(() => {
		setPendingMenu(null);
		setCanvasMenu(null);
		setContextMenu(null);
	}, []);

	const actions = useMemo<ContentNodeActions>(
		() => ({
			onDelete: (nodeId) => {
				setSelectedNodeIds((current) => reconcileSelectedNodeIds(current, current.filter((id) => id !== nodeId)));
				void onDispatch([{ type: "node.delete", nodeId }]);
			},
			onDuplicate: (nodeId) => void onDispatch([{ type: "node.duplicate", nodeId }]),
			onToggleLock: (nodeId) => {
				const node = project.graph.nodes.find((candidate) => candidate.id === nodeId);
				if (node) void onDispatch([{ type: "node.lock", nodeId, locked: !node.locked }]);
			},
			onRename: async (nodeId, name) => {
				await onDispatch([{ type: "node.rename", nodeId, name }]);
			},
			onUpdate: async (nodeId, data) => {
				const node = project.graph.nodes.find((candidate) => candidate.id === nodeId);
				const commands: ContentProjectCommand[] = [{ type: "node.update", nodeId, data }];
				if (
					node &&
					!node.locked &&
					(node.kind === "image-generator" || node.kind === "video-generator") &&
					data.aspectRatio !== node.data.aspectRatio
				) {
					const fallback = getContentNodeSize(node.kind, node.data.aspectRatio);
					const current = { width: node.width ?? fallback.width, height: node.height ?? fallback.height };
					const next = getContentNodeSize(node.kind, data.aspectRatio);
					commands.push({
						type: "node.resize",
						nodeId,
						...next,
						position: {
							x: node.position.x + (current.width - next.width) / 2,
							y: node.position.y + (current.height - next.height) / 2,
						},
					});
				}
				await onDispatch(commands);
			},
			onResize: (nodeId, position, width, height) => {
				void onDispatch([{ type: "node.resize", nodeId, position, width, height }]);
			},
			onRunNode,
			onImportAssets,
			onImportReferences,
			onAddToTimeline: (nodeId) =>
				onDispatch([
					{
						type: "timeline.clip.add",
						clip: {
							trackId: "video-1",
							sourceNodeId: nodeId,
							start: getNextClipStart(project, "video-1"),
							duration: 5,
							sourceIn: 0,
							speed: 1,
						},
					},
				]),
		}),
		[onDispatch, onImportAssets, onImportReferences, onRunNode, project],
	);
	const synchronizedNodes = useMemo(
		() => toContentFlowNodes(project, selectedNodeIdSet, models, actions, assetPreviewUrls),
		[actions, assetPreviewUrls, models, project, selectedNodeIdSet],
	);
	const synchronizedEdges = useMemo(
		() => toContentFlowEdges(project, selectedNodeIdSet),
		[project, selectedNodeIdSet],
	);
	const appliedProjectSyncKeyRef = useRef(projectSyncKey);
	const latestFlowSyncRef = useRef({
		projectSyncKey,
		nodes: synchronizedNodes,
		edges: synchronizedEdges,
	});
	latestFlowSyncRef.current = {
		projectSyncKey,
		nodes: synchronizedNodes,
		edges: synchronizedEdges,
	};

	useEffect(() => {
		const instance = flowInstanceRef.current;
		if (!instance || appliedProjectSyncKeyRef.current === projectSyncKey) return;
		appliedProjectSyncKeyRef.current = projectSyncKey;
		instance.setNodes(synchronizedNodes);
		instance.setEdges(synchronizedEdges);
	}, [projectSyncKey, synchronizedEdges, synchronizedNodes]);

	const addNode = useCallback(
		(kind: ContentNodeKind, requestedCenter?: { x: number; y: number }) => {
			const nodeId = crypto.randomUUID();
			const bounds = flowContainerRef.current?.getBoundingClientRect();
			const instance = flowInstanceRef.current;
			const center =
				requestedCenter ??
				(bounds && instance
					? instance.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
					: { x: 260, y: 180 });
			const size = getContentNodeSize(kind, createDefaultContentNodeData(kind).aspectRatio);
			const offset = project.graph.nodes.length * 18;
			const position = { x: center.x - size.width / 2 + offset, y: center.y - size.height / 2 + offset };
			const name = `${t(`node.kind.${kind}`)} ${project.graph.nodes.filter((node) => node.kind === kind).length + 1}`;
			void onDispatch([{ type: "node.add", node: { id: nodeId, kind, name, position } }]).then(() =>
				setSelectedNodeIds([nodeId]),
			);
		},
		[onDispatch, project.graph.nodes, t],
	);

	const handleCanvasDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
		if (!dataTransferHasFiles(event.dataTransfer)) return;
		event.preventDefault();
		canvasDropDepthRef.current += 1;
		setCanvasDropActive(true);
	}, []);
	const handleCanvasDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
		if (!dataTransferHasFiles(event.dataTransfer)) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
	}, []);
	const handleCanvasDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
		if (!dataTransferHasFiles(event.dataTransfer)) return;
		event.preventDefault();
		canvasDropDepthRef.current = Math.max(0, canvasDropDepthRef.current - 1);
		if (canvasDropDepthRef.current === 0) setCanvasDropActive(false);
	}, []);
	const handleCanvasDrop = useCallback(
		async (event: DragEvent<HTMLDivElement>) => {
			if (!dataTransferHasFiles(event.dataTransfer)) return;
			event.preventDefault();
			const dataTransfer = event.dataTransfer;
			const pointer = { x: event.clientX, y: event.clientY };
			canvasDropDepthRef.current = 0;
			setCanvasDropActive(false);
			const instance = flowInstanceRef.current;
			if (!instance) return;

			setImportingCanvasDrop(true);
			try {
				const files = await collectDroppedMediaFiles(dataTransfer);
				if (files.length === 0) return;
				const kind = "asset";
				const nodeId = crypto.randomUUID();
				const center = instance.screenToFlowPosition(pointer);
				const data = createDefaultContentNodeData(kind);
				const size = getContentNodeSize(kind, data.aspectRatio);
				const position = { x: center.x - size.width / 2, y: center.y - size.height / 2 };
				const name = `${t(`node.kind.${kind}`)} ${project.graph.nodes.filter((node) => node.kind === kind).length + 1}`;
				closeMenus();
				await onDispatch([{ type: "node.add", node: { id: nodeId, kind, name, position } }]);
				setSelectedNodeIds([nodeId]);
				await importDroppedMediaFiles(files, (batch) => onImportAssets(nodeId, batch));
			} finally {
				setImportingCanvasDrop(false);
			}
		},
		[closeMenus, onDispatch, onImportAssets, project.graph.nodes, t],
	);

	const clampOverlay = useCallback((clientX: number, clientY: number, size: { width: number; height: number }) => {
		const bounds = flowContainerRef.current?.getBoundingClientRect();
		if (!bounds) return null;
		return clampCanvasOverlayPosition(
			{ left: clientX - bounds.left + 8, top: clientY - bounds.top + 8 },
			size,
			{ width: bounds.width, height: bounds.height },
		);
	}, []);

	const openCanvasMenu = useCallback(
		(clientX: number, clientY: number) => {
			const instance = flowInstanceRef.current;
			const position = clampOverlay(clientX, clientY, CREATE_MENU_SIZE);
			if (!position || !instance) return;
			setPendingMenu(null);
			setContextMenu(null);
			setCanvasMenu({ ...position, position: instance.screenToFlowPosition({ x: clientX, y: clientY }) });
		},
		[clampOverlay],
	);

	const isValidConnection = useCallback(
		(connection: Connection | Edge) => Boolean(resolveContentFlowConnection(project, connection)),
		[project],
	);

	const handleConnectEnd = useCallback(
		(event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
			if (
				!shouldOpenConnectionCreateMenu({
					isValid: state.isValid,
					fromNodeId: state.fromNode?.id,
					toNodeId: state.toNode?.id,
					hasFromHandle: Boolean(state.fromHandle),
				}) ||
				!state.fromNode ||
				!state.fromHandle ||
				!flowInstanceRef.current
			) {
				return;
			}

			const pointer = getConnectionPointerPosition(event);
			if (!pointer) return;
			const menuPosition = clampOverlay(pointer.x, pointer.y, CONNECTION_MENU_SIZE);
			if (!menuPosition) return;

			const node = project.graph.nodes.find((item) => item.id === state.fromNode?.id);
			if (!node) return;

			let direction = state.fromHandle.type as "source" | "target";
			if (direction !== "source" && direction !== "target") {
				direction = state.fromHandle.id === CONTENT_FLOW_SOURCE_HANDLE_ID ? "source" : "target";
			}

			const kinds = listCompatibleNodeKinds(project, node, direction);
			if (kinds.length === 0) return;

			// Swallow the pane click that React Flow synthesizes on the same mouseup.
			suppressNextPaneClickRef.current = true;
			setCanvasMenu(null);
			setContextMenu(null);
			setPendingMenu({
				...menuPosition,
				position: flowInstanceRef.current.screenToFlowPosition(pointer),
				nodeId: state.fromNode.id,
				direction,
				kinds,
			});
		},
		[clampOverlay, project],
	);

	const createConnectedNode = useCallback(
		(kind: ContentNodeKind) => {
			if (!pendingMenu) return;
			const nodeId = crypto.randomUUID();
			const data = createDefaultContentNodeData(kind);
			const size = getContentNodeSize(kind, data.aspectRatio);
			const position = {
				x: pendingMenu.position.x - size.width / 2,
				y: pendingMenu.position.y - size.height / 2,
			};
			const name = `${t(`node.kind.${kind}`)} ${project.graph.nodes.filter((node) => node.kind === kind).length + 1}`;
			const candidateNode: ContentNode = {
				id: nodeId,
				kind,
				name,
				position,
				...size,
				status: "idle",
				data,
			};
			const candidateProject: ContentProjectDocument = {
				...project,
				graph: { ...project.graph, nodes: [...project.graph.nodes, candidateNode] },
			};
			const existingNode = project.graph.nodes.find((node) => node.id === pendingMenu.nodeId);
			if (!existingNode) return;
			const sourceNode = pendingMenu.direction === "source" ? existingNode : candidateNode;
			const targetNode = pendingMenu.direction === "source" ? candidateNode : existingNode;
			const connection = resolveContentConnection(candidateProject, sourceNode, targetNode);
			if (!connection) return;
			void onDispatch([
				{ type: "node.add", node: { id: nodeId, kind, name, position } },
				{ type: "edge.connect", source: sourceNode.id, target: targetNode.id, ...connection },
			]);
			setSelectedNodeIds([nodeId]);
			setPendingMenu(null);
		},
		[onDispatch, pendingMenu, project, t],
	);

	const selectedProjectNodes = useMemo(
		() => project.graph.nodes.filter((node) => selectedNodeIdSet.has(node.id)),
		[project.graph.nodes, selectedNodeIdSet],
	);
	const movableSelectedNodes = useMemo(
		() => selectedProjectNodes.filter((node) => !node.locked),
		[selectedProjectNodes],
	);
	const applyPlacements = useCallback(
		(placements: readonly { nodeId: string; position: { x: number; y: number } }[]) => {
			if (placements.length > 0) {
				void onDispatch(placements.map(({ nodeId, position }) => ({ type: "node.move", nodeId, position })));
			}
		},
		[onDispatch],
	);
	const alignSelection = useCallback(
		(alignment: ContentNodeAlignment) => applyPlacements(alignContentNodes(movableSelectedNodes, alignment)),
		[applyPlacements, movableSelectedNodes],
	);
	const layoutSelection = useCallback(
		(layout: ContentNodeLayout) => applyPlacements(layoutContentNodes(movableSelectedNodes, layout)),
		[applyPlacements, movableSelectedNodes],
	);
	const onInit = useCallback((instance: ReactFlowInstance<ContentFlowNode, Edge>) => {
		flowInstanceRef.current = instance;
		const latest = latestFlowSyncRef.current;
		appliedProjectSyncKeyRef.current = latest.projectSyncKey;
		instance.setNodes(latest.nodes);
		instance.setEdges(latest.edges);
	}, []);
	const onSelectionChange = useCallback<
		NonNullable<ReactFlowProps<ContentFlowNode, Edge>["onSelectionChange"]>
	>(({ nodes: selectedNodes }) => {
		const nextNodeIds = selectedNodes.map((node) => node.id);
		setSelectedNodeIds((current) => reconcileSelectedNodeIds(current, nextNodeIds));
	}, []);
	const onConnect = useCallback<NonNullable<ReactFlowProps<ContentFlowNode, Edge>["onConnect"]>>(
		(connection) => {
			const resolved = resolveContentFlowConnection(project, connection);
			if (!connection.source || !connection.target || !resolved) return;
			void onDispatch([
				{
					type: "edge.connect",
					source: connection.source,
					target: connection.target,
					...resolved,
				},
			]);
		},
		[onDispatch, project],
	);
	const onNodeClick = useCallback(() => {
		// Do not kill a just-opened drop menu if the connect ended over the source node.
		if (suppressNextPaneClickRef.current) {
			suppressNextPaneClickRef.current = false;
			return;
		}
		closeMenus();
	}, [closeMenus]);
	const onNodeContextMenu = useCallback<
		NonNullable<ReactFlowProps<ContentFlowNode, Edge>["onNodeContextMenu"]>
	>(
		(event, node) => {
			event.preventDefault();
			const position = clampOverlay(event.clientX, event.clientY, CONTEXT_MENU_SIZE);
			if (!position) return;
			setSelectedNodeIds([node.id]);
			setCanvasMenu(null);
			setPendingMenu(null);
			setContextMenu({ type: "node", nodeId: node.id, ...position });
		},
		[clampOverlay],
	);
	const onEdgeContextMenu = useCallback<
		NonNullable<ReactFlowProps<ContentFlowNode, Edge>["onEdgeContextMenu"]>
	>(
		(event, edge) => {
			event.preventDefault();
			const position = clampOverlay(event.clientX, event.clientY, CONTEXT_MENU_SIZE);
			if (!position) return;
			setCanvasMenu(null);
			setPendingMenu(null);
			setContextMenu({ type: "edge", edgeId: edge.id, ...position });
		},
		[clampOverlay],
	);
	const onPaneClick = useCallback<NonNullable<ReactFlowProps<ContentFlowNode, Edge>["onPaneClick"]>>(
		(event) => {
			if (suppressNextPaneClickRef.current) {
				suppressNextPaneClickRef.current = false;
				// Keep the connection-create menu opened by onConnectEnd.
				return;
			}
			setSelectedNodeIds([]);
			closeMenus();
			if (event.detail === 2) openCanvasMenu(event.clientX, event.clientY);
		},
		[closeMenus, openCanvasMenu],
	);
	const onPaneContextMenu = useCallback<
		NonNullable<ReactFlowProps<ContentFlowNode, Edge>["onPaneContextMenu"]>
	>(
		(event) => {
			event.preventDefault();
			openCanvasMenu(event.clientX, event.clientY);
		},
		[openCanvasMenu],
	);
	const onNodeDrag = useCallback<NonNullable<ReactFlowProps<ContentFlowNode, Edge>["onNodeDrag"]>>(
		(_, node) => {
			const flowNodes = flowInstanceRef.current?.getNodes() ?? [];
			const flowNodeById = new Map(flowNodes.map((flowNode) => [flowNode.id, flowNode]));
			const currentNodes = project.graph.nodes.map((projectNode) => {
				const flowNode = flowNodeById.get(projectNode.id);
				return flowNode ? { ...projectNode, position: flowNode.position } : projectNode;
			});
			const threshold = 6 / (flowInstanceRef.current?.getZoom() ?? 1);
			alignmentGuidesLayerRef.current?.update(findContentAlignmentGuides(currentNodes, node.id, threshold));
		},
		[project.graph.nodes],
	);
	const onNodeDragStop = useCallback<
		NonNullable<ReactFlowProps<ContentFlowNode, Edge>["onNodeDragStop"]>
	>(
		(_, __, draggedNodes) => {
			alignmentGuidesLayerRef.current?.clear();
			const movableNodeIds = new Set(project.graph.nodes.filter((node) => !node.locked).map((node) => node.id));
			void onDispatch(
				draggedNodes
					.filter((node) => movableNodeIds.has(node.id))
					.map((node) => ({ type: "node.move", nodeId: node.id, position: node.position })),
			);
		},
		[onDispatch, project.graph.nodes],
	);

	/** Host ShortcutScopeStack (not RF deleteKeyCode) so Delete participates in app/plugin scopes. */
	const deleteSelection = useCallback(() => {
		const lockedIds = new Set(project.graph.nodes.filter((node) => node.locked).map((node) => node.id));
		const nodeIdsToDelete = activeSelectedNodeIds.filter((nodeId) => !lockedIds.has(nodeId));
		const edgeIdsToDelete = (flowInstanceRef.current?.getEdges() ?? [])
			.filter((edge) => edge.selected)
			.map((edge) => edge.id);
		const commands: ContentProjectCommand[] = [
			...nodeIdsToDelete.map((nodeId) => ({ type: "node.delete" as const, nodeId })),
			...edgeIdsToDelete.map((edgeId) => ({ type: "edge.delete" as const, edgeId })),
		];
		if (commands.length === 0) return false;
		void onDispatch(commands);
		if (nodeIdsToDelete.length > 0) {
			const removed = new Set(nodeIdsToDelete);
			setSelectedNodeIds((current) => current.filter((nodeId) => !removed.has(nodeId)));
		}
		return true;
	}, [activeSelectedNodeIds, onDispatch, project.graph.nodes]);

	const isGraphSurfaceActive = useCallback(() => {
		const el = flowContainerRef.current;
		// Activity tabs stay mounted but use Tailwind `hidden` when inactive.
		return Boolean(el && el.getClientRects().length > 0);
	}, []);

	const canDeleteViaShortcut = useCallback(() => {
		if (!isGraphSurfaceActive()) return false;
		const lockedIds = new Set(project.graph.nodes.filter((node) => node.locked).map((node) => node.id));
		if (activeSelectedNodeIds.some((nodeId) => !lockedIds.has(nodeId))) return true;
		return (flowInstanceRef.current?.getEdges() ?? []).some((edge) => edge.selected);
	}, [activeSelectedNodeIds, isGraphSurfaceActive, project.graph.nodes]);

	const deleteShortcutBindings = useMemo(
		(): readonly PluginShortcutBinding[] => [
			{
				key: "delete",
				when: "not-editable",
				preventDefault: false,
				stopPropagation: false,
				run: (event) => {
					if (!deleteSelection()) return;
					event.preventDefault();
					event.stopPropagation();
				},
			},
			{
				key: "backspace",
				when: "not-editable",
				preventDefault: false,
				stopPropagation: false,
				run: (event) => {
					if (!deleteSelection()) return;
					event.preventDefault();
					event.stopPropagation();
				},
			},
		],
		[deleteSelection],
	);

	usePluginShortcutScope(registerShortcutScope, {
		id: "graph-delete",
		kind: "surface",
		enabled: canDeleteViaShortcut,
		bindings: deleteShortcutBindings,
	});

	return (
		<div className="flex h-full min-w-0 flex-1 flex-col">
			<div
				ref={flowContainerRef}
				className="content-creation-flow relative min-h-0 flex-1 overflow-hidden bg-[color-mix(in_srgb,var(--muted)_20%,var(--background))]"
				onDragEnter={handleCanvasDragEnter}
				onDragOver={handleCanvasDragOver}
				onDragLeave={handleCanvasDragLeave}
				onDrop={(event) => void handleCanvasDrop(event)}
			>
				<ContentCanvasSelectionProvider count={activeSelectedNodeIds.length}>
					<ReactFlow<ContentFlowNode, Edge>
						defaultNodes={synchronizedNodes}
						defaultEdges={synchronizedEdges}
						nodeTypes={nodeTypes}
						defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
						// Keyboard delete is handled by host ShortcutScopeStack (usePluginShortcutScope).
						deleteKeyCode={null}
						proOptions={PRO_OPTIONS}
						onInit={onInit}
						onSelectionChange={onSelectionChange}
						onConnect={onConnect}
						onConnectEnd={handleConnectEnd}
						isValidConnection={isValidConnection}
						selectionOnDrag={canvasInteraction.selectionOnDrag}
						selectionKeyCode="Control"
						selectionMode={SelectionMode.Partial}
						panOnDrag={canvasInteraction.panOnDrag}
						zoomOnDoubleClick={false}
						onNodeClick={onNodeClick}
						onNodeContextMenu={onNodeContextMenu}
						onEdgeContextMenu={onEdgeContextMenu}
						onPaneClick={onPaneClick}
						onPaneContextMenu={onPaneContextMenu}
						onNodeDrag={onNodeDrag}
						onNodeDragStop={onNodeDragStop}
						fitView
					>
						<Controls showInteractive={false} position="bottom-left" />
						<SelectionToolbar
							nodeIds={activeSelectedNodeIds}
							allLocked={selectedProjectNodes.length > 0 && selectedProjectNodes.every((node) => node.locked)}
							onAlign={alignSelection}
							onLayout={layoutSelection}
							onDuplicate={() =>
								void onDispatch(activeSelectedNodeIds.map((nodeId) => ({ type: "node.duplicate", nodeId })))
							}
							onDelete={() => {
								void onDispatch(activeSelectedNodeIds.map((nodeId) => ({ type: "node.delete", nodeId })));
								setSelectedNodeIds([]);
							}}
							onToggleLock={() => {
								const locked = !selectedProjectNodes.every((node) => node.locked);
								void onDispatch(activeSelectedNodeIds.map((nodeId) => ({ type: "node.lock", nodeId, locked })));
							}}
						/>
						<AlignmentGuidesLayer ref={alignmentGuidesLayerRef} />
					</ReactFlow>
				</ContentCanvasSelectionProvider>
				<GraphOverlayLayer
					activeTool={canvasTool}
					nodeCount={project.graph.nodes.length}
					canvasMenu={canvasMenu}
					pendingMenu={pendingMenu}
					contextMenu={contextMenu}
					contextNodeLocked={Boolean(
						contextMenu?.type === "node" && project.graph.nodes.find((node) => node.id === contextMenu.nodeId)?.locked,
					)}
					onAddNode={addNode}
					onToolChange={setCanvasTool}
					onCreateConnectedNode={createConnectedNode}
					onCloseCanvasMenu={() => setCanvasMenu(null)}
					onClosePendingMenu={() => setPendingMenu(null)}
					onDuplicateNode={actions.onDuplicate}
					onToggleNodeLock={actions.onToggleLock}
					onDeleteNode={actions.onDelete}
					onDeleteEdge={(edgeId) => void onDispatch([{ type: "edge.delete", edgeId }])}
					onCloseContextMenu={() => setContextMenu(null)}
				/>
				{canvasDropActive || importingCanvasDrop ? (
					<div className="pointer-events-none absolute inset-3 z-30 grid place-items-center rounded-lg border border-dashed border-border/80 bg-background/55 backdrop-blur-[1px]">
						<div className="flex items-center gap-2 rounded-lg border border-border/80 bg-popover/95 px-3 py-2 text-xs font-medium text-popover-foreground shadow-sm">
							<span className="icon-[lucide--folder-input] block size-4 text-muted-foreground" aria-hidden="true" />
							<span>{t(importingCanvasDrop ? "assetNode.importing" : "canvas.drop.createAsset")}</span>
						</div>
					</div>
				) : null}
			</div>
		</div>
	);
}
