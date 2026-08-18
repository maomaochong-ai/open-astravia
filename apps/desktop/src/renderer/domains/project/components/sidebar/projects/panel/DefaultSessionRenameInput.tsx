import type { SessionInfo } from "@shared/store/atoms";
import { SessionRenameInputView } from "@vetta/theme-ui/project";
import { useDefaultSessionRenameModel } from "../../../../hooks/useInlineSessionRenameModel";

interface DefaultSessionRenameInputProps {
	onDone: () => void;
	onRename: (name: string) => void;
	session: SessionInfo;
}

export function DefaultSessionRenameInput(props: DefaultSessionRenameInputProps): JSX.Element {
	const model = useDefaultSessionRenameModel(props);
	return <SessionRenameInputView {...model} />;
}
