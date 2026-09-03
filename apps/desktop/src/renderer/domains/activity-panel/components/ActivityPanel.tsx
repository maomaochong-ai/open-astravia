import { activeSessionAtom, currentScenarioAtom } from "@shared/store/atoms";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";
import { useThemeComponent } from "@vetta/theme-sdk";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useActivityPanelModel } from "../hooks/useActivityPanelModel";
import { ActivityTabMetaHost } from "../registry/ActivityTabMetaHost";
import { ActivityPanelContextProvider } from "../registry/context";
import type { ActivityTabDefinition, ActivityTabId, ActivityTabMeta } from "../registry/types";
import { useActivityTabDefinitions } from "../registry/useActivityTabDefinitions";
import { ActivityPanelFrame } from "./activity-panel/ActivityPanelFrame";
import { ActivityPanelView } from "./activity-panel/ActivityPanelView";
import type { ActivityPanelProps } from "./activity-panel/types";

function ActivityPanelWithMeta({
	cwd,
	workspaceId,
	definitions,
	metaById,
	knowledgeHistory,
	enablePluginTabs,
}: {
	cwd: string | null;
	workspaceId: string;
	definitions: readonly ActivityTabDefinition[];
	metaById: ReadonlyMap<ActivityTabId, ActivityTabMeta | null>;
	knowledgeHistory: boolean;
	enablePluginTabs: boolean;
}): JSX.Element {
	const { actions, model } = useActivityPanelModel({
		cwd,
		workspaceId,
		definitions,
		metaById,
		knowledgeHistory,
	});
	const Frame = useThemeComponent("activity.panelFrame", ActivityPanelFrame);
	return <ActivityPanelView actions={actions} Frame={Frame} model={model} />;
}

export function ActivityPanel(props: ActivityPanelProps): JSX.Element {
	const { enablePluginTabs = true, knowledgeHistory = false, enabledBuiltinTabs, pluginScenario } = props;
	const { workspace } = props;
	const cwd = workspace.cwd;

	const definitions = useActivityTabDefinitions({
		enablePluginTabs,
		knowledgeHistory,
		enabledBuiltinTabs,
		pluginScenario,
	});

	const contextValue = useMemo(
		() => ({ workspace, knowledgeHistory }),
		[workspace, knowledgeHistory],
	);

	return (
		<ActivityPanelContextProvider value={contextValue}>
			<ActivityTabMetaHost definitions={definitions}>
				{(metaById) => (
					<ActivityPanelWithMeta
						cwd={cwd}
						workspaceId={workspace.id}
						definitions={definitions}
						metaById={metaById}
						knowledgeHistory={knowledgeHistory}
						enablePluginTabs={enablePluginTabs}
					/>
				)}
			</ActivityTabMetaHost>
		</ActivityPanelContextProvider>
	);
}

/** Conversation-page adapter. The generic panel itself never reads conversation state. */
export function ConversationActivityPanel(): JSX.Element {
	const activeSession = useAtomValue(activeSessionAtom);
	const pluginScenario = useAtomValue(currentScenarioAtom) ?? undefined;
	const workspace = useMemo(
		() => createActivityWorkspace(activeSession?.cwd ?? "conversation:unbound", activeSession?.cwd ?? null),
		[activeSession?.cwd],
	);
	return <ActivityPanel workspace={workspace} pluginScenario={pluginScenario} />;
}

/** Adapter for non-conversation hosts that intentionally inherit the current plugin scenario. */
export function CurrentScenarioActivityPanel(
	props: Omit<ActivityPanelProps, "pluginScenario">,
): JSX.Element {
	const pluginScenario = useAtomValue(currentScenarioAtom) ?? undefined;
	return <ActivityPanel {...props} pluginScenario={pluginScenario} />;
}
