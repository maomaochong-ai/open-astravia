import { PerfSessionSwitchProfiler } from "@shared/lib/perf-session-switch-profiler";
import { activeSessionAtom } from "@shared/store/atoms";
import { RendererMarkdownScope } from "@shared/components/RendererMarkdownScope";
import { useRendererMarkdownModel } from "@shared/hooks/useRendererMarkdownModel";
import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { useMemo } from "react";
import { MessageCardsScope } from "../hooks/useMessageCardsHostModel";
import { useMessageListModel } from "../hooks/useMessageListModel";
import { useMessageListScrollModel } from "../hooks/useMessageListScrollModel";
import { useProgressiveMessageViewport } from "../hooks/useProgressiveMessageViewport";
import { MessageListView, ExportMessageList } from "./message-list/MessageListView";
import type { MessageListProps } from "./message-list/types";
import { MessageExpansionScope } from "./message-list/expansionStore";
import { SubagentCardsScope } from "./message-list/SubagentCardsScope";

export { ExportMessageList };

const INITIAL_DERIVATION_MESSAGE_COUNT = 4;

const activeRuntimeIdAtom = selectAtom(activeSessionAtom, (session) => session?.runtimeId ?? null);
const activeSessionPathAtom = selectAtom(activeSessionAtom, (session) => session?.sessionPath ?? null);

export function MessageList(props: MessageListProps): JSX.Element {
	const activeRuntimeId = useAtomValue(activeRuntimeIdAtom);
	const activeSessionPath = useAtomValue(activeSessionPathAtom);
	const subagentSessionId = props.sessionId && props.sessionId === activeSessionPath ? activeRuntimeId : null;
	const markdown = useRendererMarkdownModel(props.workspace.cwd, true, props.workspace.id);
	const scroll = useMessageListScrollModel({
		isStreaming: props.isStreaming,
		messages: props.messages,
		sessionId: props.sessionId,
		initialTargetKey: props.initialTargetKey,
		onInitialTargetHandled: props.onInitialTargetHandled,
	});
	const viewportPhase = useProgressiveMessageViewport(
		props.sessionId ?? null,
		props.messages.length > 0,
	);
	const derivationMessages = useMemo(
		() =>
			viewportPhase === "initial"
				? props.messages.slice(-INITIAL_DERIVATION_MESSAGE_COUNT)
				: props.messages,
		[props.messages, viewportPhase],
	);
	const model = useMessageListModel(props, scroll, derivationMessages);
	return (
		<RendererMarkdownScope value={markdown}>
			<SubagentCardsScope sessionId={subagentSessionId}>
				<MessageCardsScope scope={props.sessionId ?? null} messages={derivationMessages}>
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
