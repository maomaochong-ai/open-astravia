import type { SessionInfo } from "@shared/store/atoms";
import { SessionRenameInputView } from "@vetta/theme-ui/project";
import { useInlineSessionRenameModel } from "../../../hooks/useInlineSessionRenameModel";

interface InlineSessionRenameInputProps {
	cwd: string;
	onDone: () => void;
	onRename: (cwd: string, sessionPath: string, name: string) => void;
	session: SessionInfo;
}

export function InlineSessionRenameInput(props: InlineSessionRenameInputProps): JSX.Element {
	const model = useInlineSessionRenameModel(props);
	return <SessionRenameInputView {...model} />;
}
