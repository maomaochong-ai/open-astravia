import {
	type Connection,
	Controls,
	type Edge,
	type FinalConnectionState,
	type NodeTypes,
	ReactFlow,
	type ReactFlowInstance,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findContentAlignmentGuides, type ContentAlignmentGuides } from "./alignment-guides";
import { listCompatibleNodeKinds, resolveContentConnection } from "../node/connections";
import type { ContentProjectCommand } from "../project/commands";
import { createDefaultContentNodeData, getContentNodeDefinition } from "../node/definitions";
import { getContentNodeSize } from "../node/geometry";
import {
	alignContentNodes,
	type ContentNodeAlignment,
	type ContentNodeLayout,
	layoutContentNodes,
} from "../node/layout";
import type { ContentNode, ContentNodeKind, ContentProjectDocument } from "../project/types";
import type { ContentModelDescriptor } from "../generation/types";
import { AlignmentGuidesLayer } from "./AlignmentGuidesLayer";
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
	toContentFlowEdges,
	toContentFlowNodes,
} from "./graph-flow-adapters";
import { reconcileSelectedNodeIds } from "./selection-state";
import { SelectionToolbar } from "./SelectionToolbar";

const nodeTypes: NodeTypes = { contentNode: ContentNodeCard };
const CREATE_MENU_SIZE = { width: 320, height: 420 };
const CONNECTION_MENU_SIZE = { width: 320, height: 340 };
const CONTEXT_MENU_SIZE = { width: 190, height: 132 };

interface GraphWorkspaceProps {
	project: ContentProjectDocument;
	models: readonly ContentModelDescriptor[];
	onDispatch: (commands: readonly ContentProjectCommand[]) => Promise<void>;
	onRunNode: (nodeId: string) => Promise<void>;
}

export function GraphWorkspace({ project, models, onDispatch, onRunNode }: GraphWorkspaceProps) {
	const flowContainerRef = useRef<HTMLDivElement>(null);
	const flowInstanceRef = useRef<ReactFlowInstance<ContentFlowNode, Edge> | null>(null);
	/**
	 * React Flow fires `onPaneClick` on the same mouseup that ends a connection drag.
	 * Without this guard, `closeMenus()` immediately wipes the create-connected-node menu
	 * opened by `onConnectEnd`.
	 */
	const suppressNextPaneClickRef = useRef(false);
	const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
	const [pendingMenu, setPendingMenu] = useState<PendingConnectionMenu | null>(null);
	const [canvasMenu, setCanvasMenu] = useState<CanvasCreateMenuState | null>(null);
	const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null);
	const [alignmentGuides, setAlignmentGuides] = useState<ContentAlignmentGuides>({});
	const activeSelectedNodeIds = useMemo(
		() => selectedNodeIds.filter((nodeId) => project.graph.nodes.some((node) => node.id === nodeId)),
		[project.graph.nodes, selectedNodeIds],
	);
	const selectedNodeIdSet = useMemo(() => new Set(activeSelectedNodeIds), [activeSelectedNodeIds]);
	const projectSyncKey = createContentProjectSyncKey(
		{
			projectId: project.projectId,
			revision: project.revision,
			updatedAt: project.updatedAt,
			nodeCount: project.graph.nodes.length,
			edgeCount: project.graph.edges.length,
		},
		models,
	);

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
		[onDispatch, onRunNode, project],
	);
	const synchronizedNodes = toContentFlowNodes(project, selectedNodeIdSet, models, actions);
	const synchronizedEdges = toContentFlowEdges(project, selectedNodeIdSet);
	const appliedProjectSyncKeyRef = useRef(projectSyncKey);

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
			void onDispatch([{ type: "node.add", node: { id: nodeId, kind, position } }]).then(() => setSelectedNodeIds([nodeId]));
		},
		[onDispatch, project.graph.nodes.length],
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
		(connection: Connection | Edge) => {
			if (!connection.source || !connection.target) return false;
			const sourceNode = project.graph.nodes.find((node) => node.id === connection.source);
			const targetNode = project.graph.nodes.find((node) => node.id === connection.target);
			if (!sourceNode || !targetNode) return false;
			return Boolean(
				resolveContentConnection(
					project,
					sourceNode,
					targetNode,
					connection.sourceHandle ?? undefined,
					connection.targetHandle ?? undefined,
				),
			);
		},
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

			const handleId = state.fromHandle.id ?? undefined;
			let direction = state.fromHandle.type as "source" | "target";
			if (direction !== "source" && direction !== "target") {
				const definition = getContentNodeDefinition(node.kind);
				direction = definition.outputs.some((port) => port.id === handleId) ? "source" : "target";
			}

			const kinds = listCompatibleNodeKinds(project, node, direction, handleId);
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
				handleId,
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
			const candidateNode: ContentNode = { id: nodeId, kind, position, ...size, status: "idle", data };
			const candidateProject: ContentProjectDocument = {
				...project,
				graph: { ...project.graph, nodes: [...project.graph.nodes, candidateNode] },
			};
			const existingNode = project.graph.nodes.find((node) => node.id === pendingMenu.nodeId);
			if (!existingNode) return;
			const sourceNode = pendingMenu.direction === "source" ? existingNode : candidateNode;
			const targetNode = pendingMenu.direction === "source" ? candidateNode : existingNode;
			const sourceHandle = pendingMenu.direction === "source" ? pendingMenu.handleId : undefined;
			const targetHandle = pendingMenu.direction === "target" ? pendingMenu.handleId : undefined;
			const connection = resolveContentConnection(candidateProject, sourceNode, targetNode, sourceHandle, targetHandle);
			if (!connection) return;
			void onDispatch([
				{ type: "node.add", node: { id: nodeId, kind, position } },
				{ type: "edge.connect", source: sourceNode.id, target: targetNode.id, ...connection },
			]);
			setSelectedNodeIds([nodeId]);
			setPendingMenu(null);
		},
		[onDispatch, pendingMenu, project],
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

	return (
		<div className="flex h-full min-w-0 flex-1 flex-col">
			<div
				ref={flowContainerRef}
				className="content-creation-flow relative min-h-0 flex-1 overflow-hidden bg-[color-mix(in_srgb,var(--muted)_20%,var(--background))]"
			>
				<ContentCanvasSelectionProvider count={activeSelectedNodeIds.length}>
					<ReactFlow<ContentFlowNode, Edge>
						defaultNodes={synchronizedNodes}
						defaultEdges={synchronizedEdges}
						nodeTypes={nodeTypes}
						defaultEdgeOptions={{ interactionWidth: 28 }}
						deleteKeyCode={null}
						onlyRenderVisibleElements
						proOptions={{ hideAttribution: true }}
						onInit={(instance) => {
							flowInstanceRef.current = instance;
						}}
						onSelectionChange={({ nodes: selectedNodes }) => {
							const nextNodeIds = selectedNodes.map((node) => node.id);
							setSelectedNodeIds((current) => reconcileSelectedNodeIds(current, nextNodeIds));
						}}
						onConnect={(connection) => {
							if (!connection.source || !connection.target) return;
							void onDispatch([
								{
									type: "edge.connect",
									source: connection.source,
									target: connection.target,
									sourceHandle: connection.sourceHandle ?? undefined,
									targetHandle: connection.targetHandle ?? undefined,
								},
							]);
						}}
						onConnectEnd={handleConnectEnd}
						isValidConnection={isValidConnection}
						zoomOnDoubleClick={false}
						onNodesDelete={(deletedNodes) => {
							void onDispatch(deletedNodes.map((node) => ({ type: "node.delete", nodeId: node.id })));
						}}
						onEdgesDelete={(deletedEdges) => {
							void onDispatch(deletedEdges.map((edge) => ({ type: "edge.delete", edgeId: edge.id })));
						}}
						onNodeClick={() => {
							// Do not kill a just-opened drop menu if the connect ended over the source node.
							if (suppressNextPaneClickRef.current) {
								suppressNextPaneClickRef.current = false;
								return;
							}
							closeMenus();
						}}
						onNodeContextMenu={(event, node) => {
							event.preventDefault();
							const position = clampOverlay(event.clientX, event.clientY, CONTEXT_MENU_SIZE);
							if (!position) return;
							setSelectedNodeIds([node.id]);
							setCanvasMenu(null);
							setPendingMenu(null);
							setContextMenu({ type: "node", nodeId: node.id, ...position });
						}}
						onEdgeContextMenu={(event, edge) => {
							event.preventDefault();
							const position = clampOverlay(event.clientX, event.clientY, CONTEXT_MENU_SIZE);
							if (!position) return;
							setCanvasMenu(null);
							setPendingMenu(null);
							setContextMenu({ type: "edge", edgeId: edge.id, ...position });
						}}
						onPaneClick={(event) => {
							if (suppressNextPaneClickRef.current) {
								suppressNextPaneClickRef.current = false;
								// Keep the connection-create menu opened by onConnectEnd.
								return;
							}
							setSelectedNodeIds([]);
							closeMenus();
							if (event.detail === 2) openCanvasMenu(event.clientX, event.clientY);
						}}
						onPaneContextMenu={(event) => {
							event.preventDefault();
							openCanvasMenu(event.clientX, event.clientY);
						}}
						onNodeDrag={(_, node) => {
							const flowNodes = flowInstanceRef.current?.getNodes() ?? [];
							const currentNodes = project.graph.nodes.map((projectNode) => {
								const flowNode = flowNodes.find((candidate) => candidate.id === projectNode.id);
								return flowNode ? { ...projectNode, position: flowNode.position } : projectNode;
							});
							const threshold = 6 / (flowInstanceRef.current?.getZoom() ?? 1);
							setAlignmentGuides(findContentAlignmentGuides(currentNodes, node.id, threshold));
						}}
						onNodeDragStop={(_, __, draggedNodes) => {
							setAlignmentGuides({});
							const movableNodeIds = new Set(
								project.graph.nodes.filter((node) => !node.locked).map((node) => node.id),
							);
							void onDispatch(
								draggedNodes
									.filter((node) => movableNodeIds.has(node.id))
									.map((node) => ({ type: "node.move", nodeId: node.id, position: node.position })),
							);
						}}
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
						<AlignmentGuidesLayer guides={alignmentGuides} />
					</ReactFlow>
				</ContentCanvasSelectionProvider>
				<GraphOverlayLayer
					nodeCount={project.graph.nodes.length}
					canvasMenu={canvasMenu}
					pendingMenu={pendingMenu}
					contextMenu={contextMenu}
					contextNodeLocked={Boolean(
						contextMenu?.type === "node" && project.graph.nodes.find((node) => node.id === contextMenu.nodeId)?.locked,
					)}
					onAddNode={addNode}
					onCreateConnectedNode={createConnectedNode}
					onCloseCanvasMenu={() => setCanvasMenu(null)}
					onClosePendingMenu={() => setPendingMenu(null)}
					onDuplicateNode={actions.onDuplicate}
					onToggleNodeLock={actions.onToggleLock}
					onDeleteNode={actions.onDelete}
					onDeleteEdge={(edgeId) => void onDispatch([{ type: "edge.delete", edgeId }])}
					onCloseContextMenu={() => setContextMenu(null)}
				/>
			</div>
		</div>
	);
}
