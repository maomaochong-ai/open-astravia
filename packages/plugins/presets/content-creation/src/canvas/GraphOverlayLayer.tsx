import type { ContentNodeKind } from "../project/types";
import { EdgeCanvasContextMenu, NodeCanvasContextMenu } from "./CanvasContextMenu";
import { ConnectionCreateMenu } from "./ConnectionCreateMenu";
import { CanvasCreateMenu, EmptyCanvasStarter, NodeLibrary } from "./NodeLibrary";

export interface PendingConnectionMenu {
	left: number;
	top: number;
	position: { x: number; y: number };
	nodeId: string;
	direction: "source" | "target";
	handleId?: string;
	kinds: readonly ContentNodeKind[];
}

export interface CanvasCreateMenuState {
	left: number;
	top: number;
	position: { x: number; y: number };
}

export type CanvasContextMenuState =
	| { type: "node"; nodeId: string; left: number; top: number }
	| { type: "edge"; edgeId: string; left: number; top: number };

interface GraphOverlayLayerProps {
	nodeCount: number;
	canvasMenu: CanvasCreateMenuState | null;
	pendingMenu: PendingConnectionMenu | null;
	contextMenu: CanvasContextMenuState | null;
	contextNodeLocked: boolean;
	onAddNode: (kind: ContentNodeKind, center?: { x: number; y: number }) => void;
	onCreateConnectedNode: (kind: ContentNodeKind) => void;
	onCloseCanvasMenu: () => void;
	onClosePendingMenu: () => void;
	onDuplicateNode: (nodeId: string) => void;
	onToggleNodeLock: (nodeId: string) => void;
	onDeleteNode: (nodeId: string) => void;
	onDeleteEdge: (edgeId: string) => void;
	onCloseContextMenu: () => void;
}

export function GraphOverlayLayer({
	nodeCount,
	canvasMenu,
	pendingMenu,
	contextMenu,
	contextNodeLocked,
	onAddNode,
	onCreateConnectedNode,
	onCloseCanvasMenu,
	onClosePendingMenu,
	onDuplicateNode,
	onToggleNodeLock,
	onDeleteNode,
	onDeleteEdge,
	onCloseContextMenu,
}: GraphOverlayLayerProps) {
	return (
		<>
			{nodeCount === 0 ? <EmptyCanvasStarter onAdd={onAddNode} /> : null}
			<NodeLibrary onAdd={onAddNode} />
			{canvasMenu ? (
				<CanvasCreateMenu
					left={canvasMenu.left}
					top={canvasMenu.top}
					onSelect={(kind) => {
						onAddNode(kind, canvasMenu.position);
						onCloseCanvasMenu();
					}}
				/>
			) : null}
			{pendingMenu ? (
				<ConnectionCreateMenu
					left={pendingMenu.left}
					top={pendingMenu.top}
					kinds={pendingMenu.kinds}
					onSelect={onCreateConnectedNode}
					onClose={onClosePendingMenu}
				/>
			) : null}
			{contextMenu?.type === "node" ? (
				<NodeCanvasContextMenu
					left={contextMenu.left}
					top={contextMenu.top}
					locked={contextNodeLocked}
					onDuplicate={() => {
						onDuplicateNode(contextMenu.nodeId);
						onCloseContextMenu();
					}}
					onToggleLock={() => {
						onToggleNodeLock(contextMenu.nodeId);
						onCloseContextMenu();
					}}
					onDelete={() => {
						onDeleteNode(contextMenu.nodeId);
						onCloseContextMenu();
					}}
				/>
			) : null}
			{contextMenu?.type === "edge" ? (
				<EdgeCanvasContextMenu
					left={contextMenu.left}
					top={contextMenu.top}
					onDelete={() => {
						onDeleteEdge(contextMenu.edgeId);
						onCloseContextMenu();
					}}
				/>
			) : null}
		</>
	);
}
