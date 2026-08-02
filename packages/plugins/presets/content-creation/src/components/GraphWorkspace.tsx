import {
	Background,
	type Connection,
	Controls,
	type Edge,
	type FinalConnectionState,
	MiniMap,
	type NodeTypes,
	ReactFlow,
	type ReactFlowInstance,
	useEdgesState,
	useNodesState,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listCompatibleNodeKinds, resolveContentConnection } from "../domain/connections";
import type { ContentProjectCommand } from "../domain/commands";
import { createDefaultContentNodeData } from "../domain/node-definitions";
import type { ContentNode, ContentNodeData, ContentNodeKind, ContentProjectDocument } from "../domain/model";
import { getContentNodeSize } from "../domain/node-geometry";
import type { ContentModelDescriptor } from "../generation/types";
import { ConnectionCreateMenu } from "./ConnectionCreateMenu";
import { ContentNodeCard, type ContentFlowNode } from "./ContentNodeCard";
import { CanvasCreateMenu, EmptyCanvasStarter, NodeLibrary } from "./NodeLibrary";

const nodeTypes: NodeTypes = { contentNode: ContentNodeCard };

interface NodeActions {
	onDelete: (nodeId: string) => void;
	onDuplicate: (nodeId: string) => void;
	onUpdate: (nodeId: string, data: ContentNodeData) => Promise<void>;
	onResize: (nodeId: string, position: { x: number; y: number }, width: number, height: number) => void;
	onRunNode: (nodeId: string) => Promise<void>;
	onAddToTimeline: (nodeId: string) => Promise<void>;
}

function nextClipStart(project: ContentProjectDocument, trackId: string): number {
	const track = project.timeline.tracks.find((candidate) => candidate.id === trackId);
	return track?.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0) ?? 0;
}

function toFlowNodes(
	project: ContentProjectDocument,
	selectedNodeId: string | null,
	models: readonly ContentModelDescriptor[],
	actions: NodeActions,
): ContentFlowNode[] {
	return project.graph.nodes.map((node) => ({
		...getContentNodeSize(node.kind, node.data.aspectRatio),
		width: node.width ?? getContentNodeSize(node.kind, node.data.aspectRatio).width,
		height: node.height ?? getContentNodeSize(node.kind, node.data.aspectRatio).height,
		id: node.id,
		type: "contentNode",
		position: node.position,
		selected: node.id === selectedNodeId,
		data: {
			kind: node.kind,
			nodeData: node.data,
			assetUrl: node.data.assetId ? project.assets.find((asset) => asset.id === node.data.assetId)?.url : undefined,
			assetKind: node.data.assetId ? project.assets.find((asset) => asset.id === node.data.assetId)?.kind : undefined,
			status: node.status,
			models,
			hasGenerationError:
				project.jobs.filter((job) => job.nodeId === node.id).at(-1)?.status === "failed",
			onDelete: () => actions.onDelete(node.id),
			onDuplicate: () => actions.onDuplicate(node.id),
			onUpdate: (data) => actions.onUpdate(node.id, data),
			onResize: (position, width, height) => actions.onResize(node.id, position, width, height),
			onRunNode: () => actions.onRunNode(node.id),
			onAddToTimeline:
				node.kind === "image-generator" || node.kind === "video-generator" || node.kind === "asset"
					? () => actions.onAddToTimeline(node.id)
					: undefined,
		},
	}));
}

function toFlowEdges(project: ContentProjectDocument, selectedNodeId: string | null): Edge[] {
	return project.graph.edges.map((edge) => ({
		...edge,
		className: selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId) ? "is-related" : undefined,
		sourceHandle: edge.sourceHandle,
		targetHandle: edge.targetHandle,
	}));
}

interface PendingConnectionMenu {
	left: number;
	top: number;
	position: { x: number; y: number };
	nodeId: string;
	direction: "source" | "target";
	handleId?: string;
	kinds: readonly ContentNodeKind[];
}

interface CanvasCreateMenuState {
	left: number;
	top: number;
	position: { x: number; y: number };
}

interface GraphWorkspaceProps {
	project: ContentProjectDocument;
	selectedNodeId: string | null;
	models: readonly ContentModelDescriptor[];
	onSelectNode: (nodeId: string | null) => void;
	onDispatch: (commands: readonly ContentProjectCommand[]) => Promise<void>;
	onRunNode: (nodeId: string) => Promise<void>;
}

function pointerPosition(event: MouseEvent | TouchEvent): { x: number; y: number } | null {
	if ("changedTouches" in event) {
		const touch = event.changedTouches[0];
		return touch ? { x: touch.clientX, y: touch.clientY } : null;
	}
	return { x: event.clientX, y: event.clientY };
}

export function GraphWorkspace({ project, selectedNodeId, models, onSelectNode, onDispatch, onRunNode }: GraphWorkspaceProps) {
	const flowContainerRef = useRef<HTMLDivElement>(null);
	const flowInstanceRef = useRef<ReactFlowInstance<ContentFlowNode, Edge> | null>(null);
	const [pendingMenu, setPendingMenu] = useState<PendingConnectionMenu | null>(null);
	const [canvasMenu, setCanvasMenu] = useState<CanvasCreateMenuState | null>(null);

	const actions = useMemo<NodeActions>(
		() => ({
			onDelete: (nodeId) => {
				if (selectedNodeId === nodeId) onSelectNode(null);
				void onDispatch([{ type: "node.delete", nodeId }]);
			},
			onDuplicate: (nodeId) => void onDispatch([{ type: "node.duplicate", nodeId }]),
			onUpdate: async (nodeId, data) => {
				const node = project.graph.nodes.find((candidate) => candidate.id === nodeId);
				const commands: ContentProjectCommand[] = [{ type: "node.update", nodeId, data }];
				if (
					node &&
					(node.kind === "image-generator" || node.kind === "video-generator") &&
					data.aspectRatio !== node.data.aspectRatio
				) {
					const current = { width: node.width ?? getContentNodeSize(node.kind, node.data.aspectRatio).width, height: node.height ?? getContentNodeSize(node.kind, node.data.aspectRatio).height };
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
							start: nextClipStart(project, "video-1"),
							duration: 5,
							sourceIn: 0,
							speed: 1,
						},
					},
				]),
		}),
		[onDispatch, onRunNode, onSelectNode, project, selectedNodeId],
	);
	const [nodes, setNodes, onNodesChange] = useNodesState<ContentFlowNode>(
		toFlowNodes(project, selectedNodeId, models, actions),
	);
	const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toFlowEdges(project, selectedNodeId));

	useEffect(
		() => setNodes(toFlowNodes(project, selectedNodeId, models, actions)),
		[actions, models, project, selectedNodeId, setNodes],
	);
	useEffect(() => setEdges(toFlowEdges(project, selectedNodeId)), [project, selectedNodeId, setEdges]);

	const addNode = useCallback(
		(kind: ContentNodeKind, requestedCenter?: { x: number; y: number }) => {
			const nodeId = crypto.randomUUID();
			const bounds = flowContainerRef.current?.getBoundingClientRect();
			const instance = flowInstanceRef.current;
			const center = requestedCenter ?? (bounds && instance
				? instance.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
				: { x: 260, y: 180 });
			const size = getContentNodeSize(kind, createDefaultContentNodeData(kind).aspectRatio);
			const offset = project.graph.nodes.length * 18;
			const position = { x: center.x - size.width / 2 + offset, y: center.y - size.height / 2 + offset };
			void onDispatch([{ type: "node.add", node: { id: nodeId, kind, position } }]).then(() => onSelectNode(nodeId));
		},
		[onDispatch, onSelectNode, project.graph.nodes.length],
	);

	const openCanvasMenu = useCallback((clientX: number, clientY: number) => {
		const bounds = flowContainerRef.current?.getBoundingClientRect();
		const instance = flowInstanceRef.current;
		if (!bounds || !instance) return;
		setPendingMenu(null);
		setCanvasMenu({
			left: clientX - bounds.left,
			top: clientY - bounds.top,
			position: instance.screenToFlowPosition({ x: clientX, y: clientY }),
		});
	}, []);

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
			if (state.isValid || state.toNode || !state.fromNode || !state.fromHandle || !flowInstanceRef.current) return;
			const pointer = pointerPosition(event);
			const bounds = flowContainerRef.current?.getBoundingClientRect();
			if (!pointer || !bounds) return;
			const direction = state.fromHandle.type;
			const node = project.graph.nodes.find((item) => item.id === state.fromNode?.id);
			if (!node) return;
			const kinds = listCompatibleNodeKinds(project, node, direction, state.fromHandle.id ?? undefined);
			if (kinds.length === 0) return;
			setPendingMenu({
				left: pointer.x - bounds.left,
				top: pointer.y - bounds.top,
				position: flowInstanceRef.current.screenToFlowPosition(pointer),
				nodeId: state.fromNode.id,
				direction,
				handleId: state.fromHandle.id ?? undefined,
				kinds,
			});
		},
		[project],
	);

	const createConnectedNode = useCallback(
		(kind: ContentNodeKind) => {
			if (!pendingMenu) return;
			const nodeId = crypto.randomUUID();
			const candidateNode: ContentNode = {
				id: nodeId,
				kind,
				position: pendingMenu.position,
				status: "idle",
				data: createDefaultContentNodeData(kind),
			};
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
				{ type: "node.add", node: { id: nodeId, kind, position: pendingMenu.position } },
				{ type: "edge.connect", source: sourceNode.id, target: targetNode.id, ...connection },
			]);
			onSelectNode(nodeId);
			setPendingMenu(null);
		},
		[onDispatch, onSelectNode, pendingMenu, project],
	);

	return (
		<div className="content-creation-graph">
			<div ref={flowContainerRef} className="content-creation-flow">
				<ReactFlow<ContentFlowNode, Edge>
					nodes={nodes}
					edges={edges}
					nodeTypes={nodeTypes}
					onInit={(instance) => {
						flowInstanceRef.current = instance;
					}}
					onNodesChange={onNodesChange}
					onEdgesChange={onEdgesChange}
					onConnect={(connection) => {
						if (!connection.source || !connection.target) return;
						void onDispatch([{
							type: "edge.connect",
							source: connection.source,
							target: connection.target,
							sourceHandle: connection.sourceHandle ?? undefined,
							targetHandle: connection.targetHandle ?? undefined,
						}]);
					}}
					onConnectEnd={handleConnectEnd}
					isValidConnection={isValidConnection}
					zoomOnDoubleClick={false}
					onEdgesDelete={(deletedEdges) => {
						void onDispatch(deletedEdges.map((edge) => ({ type: "edge.delete", edgeId: edge.id })));
					}}
					onNodeClick={(_, node) => onSelectNode(node.id)}
					onPaneClick={(event) => {
						onSelectNode(null);
						setPendingMenu(null);
						if (event.detail === 2) openCanvasMenu(event.clientX, event.clientY);
						else setCanvasMenu(null);
					}}
					onPaneContextMenu={(event) => {
						event.preventDefault();
						openCanvasMenu(event.clientX, event.clientY);
					}}
					onNodeDragStop={(_, node) =>
						void onDispatch([{ type: "node.move", nodeId: node.id, position: node.position }])
					}
					fitView
				>
					<Background gap={24} size={1} />
					<MiniMap pannable zoomable />
					<Controls />
				</ReactFlow>
				{project.graph.nodes.length === 0 ? <EmptyCanvasStarter onAdd={addNode} /> : null}
				<NodeLibrary onAdd={addNode} />
				{canvasMenu ? (
					<CanvasCreateMenu
						left={canvasMenu.left}
						top={canvasMenu.top}
						onSelect={(kind) => {
							addNode(kind, canvasMenu.position);
							setCanvasMenu(null);
						}}
					/>
				) : null}
				{pendingMenu ? (
					<ConnectionCreateMenu
						left={pendingMenu.left}
						top={pendingMenu.top}
						kinds={pendingMenu.kinds}
						onSelect={createConnectedNode}
					/>
				) : null}
			</div>
		</div>
	);
}
