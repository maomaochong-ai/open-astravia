import { ActivityPanel } from "@domains/activity-panel/components/ActivityPanel";
import { cn } from "@shared/lib/utils";
import { useThemeSurface } from "@vetta/theme-sdk/appearance";
import { SessionViewerPageView } from "@vetta/theme-ui/chat";
import { useSessionViewerPageModel } from "../hooks/useSessionViewerPageModel";
import { ChatExportHost } from "./ChatExportHost";
import { MessageList } from "./MessageList";

/**
 * Read-only viewer for sessions the desktop app does not own (currently
 * IM sessions written by im-gateway).
 */
export function SessionViewerPage(): JSX.Element {
	const surface = useThemeSurface("chat.sessionViewerPage");
	const model = useSessionViewerPageModel();

	return (
		<SessionViewerPageView
			rootClassName={cn("flex h-full min-w-0 flex-1 flex-col bg-background", surface?.rootClassName)}
			emptyPathLabel={model.emptyPathLabel}
			error={model.error}
			errorPrefix={model.errorPrefix}
			hasPath={Boolean(model.path)}
			exportHost={
				model.exporting ? (
					<ChatExportHost
						messages={model.messages}
						title={model.exportTitle}
						onFinished={model.onExportFinished}
					/>
				) : null
			}
			messageList={<MessageList messages={model.messages} isStreaming={false} sessionId={null} />}
			activityPanel={
				model.isKnowledge ? (
					<ActivityPanel cwd={model.kbCwd || null} enablePluginTabs={false} knowledgeHistory />
				) : (
					<ActivityPanel cwd={model.imCwd || null} enablePluginTabs={false} />
				)
			}
		/>
	);
}
