import type { SessionInfo } from "@shared/store/atoms";
import { SessionRowView } from "@vetta/theme-ui/project";
import { useSessionRowModel } from "../../../hooks/useSessionRowModel";

interface SessionRowProps {
	active: boolean;
	cwd: string;
	renaming: boolean;
	running: boolean;
	scheduled: boolean;
	session: SessionInfo;
	onOpenContextMenu: (event: React.MouseEvent, session: SessionInfo) => void;
	onRename: (cwd: string, sessionPath: string, name: string) => void;
	onRenameDone: () => void;
	onSelect: (cwd: string, sessionPath: string) => void;
}

export function SessionRow(props: SessionRowProps): JSX.Element {
	const model = useSessionRowModel(props);
	return <SessionRowView {...model} />;
}
