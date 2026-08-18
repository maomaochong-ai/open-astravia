import type { DefaultConversationFilter, SessionInfo } from "@shared/store/atoms";
import { DefaultSessionRowView } from "@vetta/theme-ui/project";
import { useDefaultSessionRowModel } from "../../../../hooks/useDefaultSessionRowModel";

interface DefaultSessionRowProps {
	active: boolean;
	filter: DefaultConversationFilter;
	onOpenContextMenu: (event: React.MouseEvent, session: SessionInfo) => void;
	onRename: (name: string) => void;
	onRenameDone: () => void;
	onSelect: () => void;
	renaming: boolean;
	running: boolean;
	scheduled: boolean;
	session: SessionInfo;
}

export function DefaultSessionRow(props: DefaultSessionRowProps): JSX.Element {
	const model = useDefaultSessionRowModel(props);
	return <DefaultSessionRowView {...model} />;
}
