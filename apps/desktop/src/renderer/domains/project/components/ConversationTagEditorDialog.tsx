import { ConversationTagEditorDialogView } from "@vetta/theme-ui/project";
import { useConversationTagEditorModel } from "../hooks/useConversationTagEditorModel";

export function ConversationTagEditorDialog(): JSX.Element | null {
	const model = useConversationTagEditorModel();
	return model ? <ConversationTagEditorDialogView {...model} /> : null;
}
