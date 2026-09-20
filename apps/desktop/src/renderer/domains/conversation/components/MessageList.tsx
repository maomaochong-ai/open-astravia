import { PerfSessionSwitchProfiler } from "@shared/lib/perf-session-switch-profiler";
import { useMessageListModel } from "../hooks/useMessageListModel";
import { useProgressiveMessageViewport } from "../hooks/useProgressiveMessageViewport";
import { MessageListView, ExportMessageList } from "./message-list/MessageListView";
import type { MessageListProps } from "./message-list/types";
import { MessageCardsScope } from "../hooks/useMessageCardsHostModel";
import { MessageExpansionScope } from "./message-list/expansionStore";
import { RendererMarkdownScope } from "@shared/components/RendererMarkdownScope";
import { useRendererMarkdownModel } from "@shared/hooks/useRendererMarkdownModel";
import { activeSessionAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { SubagentCardsScope } from "./message-list/SubagentCardsScope";

export { ExportMessageList };

const activeRuntimeIdAtom = selectAtom(activeSessionAtom, (session) => session?.runtimeId ?? null);
const activeSessionPathAtom = selectAtom(activeSessionAtom, (session) => session?.sessionPath ?? null);

export function MessageList(props: MessageListProps): JSX.Element {
	const activeRuntimeId = useAtomValue(activeRuntimeIdAtom);
	const activeSessionPath = useAtomValue(activeSessionPathAtom);
	const subagentSessionId = props.sessionId && props.sessionId === activeSessionPath ? activeRuntimeId : null;
	const model = useMessageListModel(props);
	const markdown = useRendererMarkdownModel(props.workspace.cwd, true, props.workspace.id);
	const viewportPhase = useProgressiveMessageViewport(
		props.sessionId ?? null,
		props.messages.length > 0,
		model.scroll.restoreStateFrom !== undefined,
	);
	return (
		<RendererMarkdownScope value={markdown}>
			<SubagentCardsScope sessionId={subagentSessionId}>
				<MessageCardsScope scope={props.sessionId ?? null} messages={props.messages}>
					<MessageExpansionScope scope={props.sessionId ?? null}>
						<PerfSessionSwitchProfiler id={`MessageList:${viewportPhase}-viewport`}>
							<MessageListView
								model={model}
								viewportPhase={viewportPhase}
								onAbort={props.onAbort}
								sessionId={props.sessionId}
								pendingLabel={props.pendingLabel}
							>
								{props.children}
							</MessageListView>
						</PerfSessionSwitchProfiler>
					</MessageExpansionScope>
				</MessageCardsScope>
			</SubagentCardsScope>
		</RendererMarkdownScope>
	);
}
