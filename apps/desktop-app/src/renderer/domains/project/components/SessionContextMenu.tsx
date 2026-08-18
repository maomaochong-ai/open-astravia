import type { SessionInfo } from "@shared/store/atoms";
import { SessionContextMenuView } from "@vetta/theme-ui/project";
import { createPortal } from "react-dom";
import { useSessionContextMenuModel } from "../hooks/useSessionContextMenuModel";

interface SessionContextMenuProps {
	x: number;
	y: number;
	session: SessionInfo;
	onClose: () => void;
	onDelete: (session: SessionInfo) => void;
}

export function SessionContextMenu({
	x,
	y,
	session,
	onClose,
	onDelete,
}: SessionContextMenuProps): JSX.Element {
	const model = useSessionContextMenuModel(session, onClose, onDelete);
	return createPortal(<SessionContextMenuView {...model} x={x} y={y} />, document.body);
}
