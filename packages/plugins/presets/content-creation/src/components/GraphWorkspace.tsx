import {
	Background,
	type Connection,
	Controls,
	type Edge,
	MiniMap,
	ReactFlow,
	type NodeTypes,
	useEdgesState,
	useNodesState,
} from "@xyflow/react";
import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { useEffect, useMemo } from "react";
import type { ContentProjectCommand } from "../domain/commands";
import type { ContentNodeKind, ContentProjectDocument } from "../domain/model";
import { AddIcon } from "./icons";
import { ContentNodeCard, type ContentFlowNode } from "./ContentNodeCard";

const nodeTypes: NodeTypes = { videoNode: ContentNodeCard };

function toFlowNodes(project: ContentProjectDocument): ContentFlowNode[] {
	return project.graph.nodes.map((node) => ({
		id: node.id,
		type: "videoNode",
		position: node.position,
		data: { kind: node.kind, status: node.status, label: node.data.label, prompt: node.data.prompt },
	}));
}

function toFlowEdges(project: ContentProjectDocument): Edge[] {
	return project.graph.edges.map((edge) => ({ ...edge, animated: false }));
}

interface GraphWorkspaceProps {
	project: ContentProjectDocument;
	selectedNodeId: string | null;
	onSelectNode: (nodeId: string | null) => void;
	onDispatch: (commands: readonly ContentProjectCommand[]) => Promise<void>;
}

export function GraphWorkspace({ project, selectedNodeId, onSelectNode, onDispatch }: GraphWorkspaceProps) {
	const { t } = useTranslation();
	const initialNodes = useMemo(() => toFlowNodes(project), []);
	const initialEdges = useMemo(() => toFlowEdges(project), []);
	const [nodes, setNodes, onNodesChange] = useNodesState<ContentFlowNode>(initialNodes);
	const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

	useEffect(() => setNodes(toFlowNodes(project)), [project.graph.nodes, setNodes]);
	useEffect(() => setEdges(toFlowEdges(project)), [project.graph.edges, setEdges]);

	const addNode = (kind: ContentNodeKind) => {
		const offset = project.graph.nodes.length * 28;
		void onDispatch([{ type: "node.add", node: { kind, position: { x: 100 + offset, y: 80 + offset } } }]);
	};

	const connect = (connection: Connection) => {
		if (!connection.source || !connection.target) return;
		void onDispatch([{ type: "edge.connect", source: connection.source, target: connection.target }]);
	};

	return (
		<div className="content-creation-graph">
			<div className="content-creation-toolbar">
				<Button type="button" size="sm" variant="outline" onClick={() => addNode("prompt")}>
					<AddIcon /> {t("action.addPrompt")}
				</Button>
				<Button type="button" size="sm" variant="outline" onClick={() => addNode("image-generator")}>
					<AddIcon /> {t("action.addImageGenerator")}
				</Button>
				<Button type="button" size="sm" variant="outline" onClick={() => addNode("video-generator")}>
					<AddIcon /> {t("action.addVideoGenerator")}
				</Button>
				<Button type="button" size="sm" variant="outline" onClick={() => addNode("output")}>
					<AddIcon /> {t("action.addOutput")}
				</Button>
			</div>

			<div className="content-creation-flow">
				<ReactFlow<ContentFlowNode, Edge>
					nodes={nodes.map((node) => ({ ...node, selected: node.id === selectedNodeId }))}
					edges={edges}
					nodeTypes={nodeTypes}
					onNodesChange={onNodesChange}
					onEdgesChange={onEdgesChange}
					onConnect={connect}
					onNodeClick={(_, node) => onSelectNode(node.id)}
					onPaneClick={() => onSelectNode(null)}
					onNodeDragStop={(_, node) =>
						void onDispatch([{ type: "node.move", nodeId: node.id, position: node.position }])
					}
					fitView
					minZoom={0.25}
					maxZoom={2}
				>
					<Background gap={24} size={1} />
					<MiniMap pannable zoomable />
					<Controls showInteractive={false} />
				</ReactFlow>
				{project.graph.nodes.length === 0 && (
					<div className="content-creation-empty">
						<p>{t("graph.empty.title")}</p>
						<span>{t("graph.empty.description")}</span>
					</div>
				)}
			</div>
		</div>
	);
}
