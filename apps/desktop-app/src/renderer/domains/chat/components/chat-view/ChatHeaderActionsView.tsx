import { ChatHeaderActionsView as ThemeChatHeaderActionsView } from "@vetta/theme-ui/chat";
import { BackgroundTasksBadge } from "../BackgroundTasksBadge";
import { SandboxGrantsBadge } from "../SandboxGrantsBadge";
import type { ChatViewActions, ChatViewHeaderModel } from "./types";

interface ChatHeaderActionsViewProps {
	actions: ChatViewActions;
	model: ChatViewHeaderModel;
}

export function ChatHeaderActionsView({ actions, model }: ChatHeaderActionsViewProps): JSX.Element {
	return (
		<ThemeChatHeaderActionsView
			badges={
				<>
					<BackgroundTasksBadge />
					<SandboxGrantsBadge />
				</>
			}
			exportTitle={model.exportTitle}
			exportDisabled={model.exportDisabled}
			exporting={model.exporting}
			onOpenExport={actions.openExport}
			pinTitle={model.pinTitle}
			pinned={model.pinned}
			onTogglePin={actions.togglePin}
			panelTitle={model.panelTitle}
			panelOpen={model.panelOpen}
			onTogglePanel={actions.togglePanel}
		/>
	);
}
