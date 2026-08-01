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
import { useTranslation } from "@vetta-org/plugin-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listCompatibleNodeKinds, resolveContentConnection } from "../domain/connections";
import type { ContentProjectCommand } from "../domain/commands";
import { createDefaultContentNodeData } from "../domain/node-definitions";
import type { ContentNode, ContentNodeKind, ContentProjectDocument } from "../domain/model";
import { ConnectionCreateMenu } from "./ConnectionCreateMenu";
import { ContentNodeCard, type ContentFlowNode } from "./ContentNodeCard";
import { NodeLibrary } from "./NodeLibrary";

const nodeTypes: NodeTypes = { contentNode: ContentNodeCard };

interface NodeActions {
	onDelete: (nodeId: string) => void;
	onDuplicate: (nodeId: string) => void;
}

function toFlowNodes(project: ContentProjectDocument, actions: NodeActions): ContentFlowNode[] {
	return project.graph.nodes.map((node) => ({
		id: node.id,
		type: "contentNode",
		position: node.position,
		data: {
			kind: node.kind,
			label: node.data.label ?? "",
			prompt: node.data.prompt,
			assetUrl: node.data.assetId
				? project.assets.find((asset) => asset.id === node.data.assetId)?.url
				: undefined,
			status: node.status,
			onDelete: () => actions.onDelete(node.id),
			onDuplicate: () => actions.onDuplicate(node.id),
		},
	}));
}

function toFlowEdges(project: ContentProjectDocument): Edge[] {
	return project.graph.edges.map((edge) => ({
		...edge,
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

interface GraphWorkspaceProps {
	project: ContentProjectDocument;
	selectedNodeId: string | null;
	onSelectNode: (nodeId: string | null) => void;
	onDispatch: (commands: readonly ContentProjectCommand[]) => Promise<void>;
}

function pointerPosition(event: MouseEvent | TouchEvent): { x: number; y: number } | null {
	if ("changedTouches" in event) {
		const touch = event.changedTouches[0];
		return touch ? { x: touch.clientX, y: touch.clientY } : null;
	}
	return { x: event.clientX, y: event.clientY };
}

export function GraphWorkspace({ project, selectedNodeId, onSelectNode, onDispatch }: GraphWorkspaceProps) {
	const { t } = useTranslation();
	const flowContainerRef = useRef<HTMLDivElement>(null);
	const flowInstanceRef = useRef<ReactFlowInstance<ContentFlowNode, Edge> | null>(null);
	const [pendingMenu, setPendingMenu] = useState<PendingConnectionMenu | null>(null);

	const actions = useMemo<NodeActions>(
		() => ({
			onDelete: (nodeId) => void onDispatch([{ type: "node.delete", nodeId }]),
			onDuplicate: (nodeId) => void onDispatch([{ type: "node.duplicate", nodeId }]),
		}),
		[onDispatch],
	);
	const [nodes, setNodes, onNodesChange] = useNodesState<ContentFlowNode>(toFlowNodes(project, actions));
	const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toFlowEdges(project));

	useEffect(() => setNodes(toFlowNodes(project, actions)), [actions, project, setNodes]);
	useEffect(() => setEdges(toFlowEdges(project)), [project, setEdges]);

	const addNode = useCallback(
		(kind: ContentNodeKind) => {
			const offset = project.graph.nodes.length * 32;
			void onDispatch([{ type: "node.add", node: { kind, position: { x: 100 + offset, y: 80 + offset } } }]);
		},
		[onDispatch, project.graph.nodes.length],
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
			<div className="content-creation-toolbar">
				<NodeLibrary onAdd={addNode} />
				<span className="content-creation-toolbar__hint">{t("graph.connectionHint")}</span>
			</div>
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
					onEdgesDelete={(deletedEdges) => {
						void onDispatch(deletedEdges.map((edge) => ({ type: "edge.delete", edgeId: edge.id })));
					}}
					onNodeClick={(_, node) => onSelectNode(node.id)}
					onPaneClick={() => {
						onSelectNode(null);
						setPendingMenu(null);
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
				{project.graph.nodes.length === 0 ? <div className="content-creation-empty">{t("graph.empty")}</div> : null}
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
