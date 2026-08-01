import { activeSessionAtom } from "@shared/store/atoms";
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
	definitions,
	metaById,
	knowledgeHistory,
	enablePluginTabs,
}: {
	cwd: string | null;
	definitions: readonly ActivityTabDefinition[];
	metaById: ReadonlyMap<ActivityTabId, ActivityTabMeta | null>;
	knowledgeHistory: boolean;
	enablePluginTabs: boolean;
}): JSX.Element {
	const { actions, model } = useActivityPanelModel({
		cwd,
		definitions,
		metaById,
		knowledgeHistory,
		enablePluginTabs,
	});
	const Frame = useThemeComponent("activity.panelFrame", ActivityPanelFrame);
	return <ActivityPanelView actions={actions} Frame={Frame} model={model} />;
}

export function ActivityPanel(props: ActivityPanelProps = {}): JSX.Element {
	const { enablePluginTabs = true, knowledgeHistory = false } = props;
	const activeSession = useAtomValue(activeSessionAtom);
	const cwd = props.cwd ?? activeSession?.cwd ?? null;

	const definitions = useActivityTabDefinitions({ enablePluginTabs, knowledgeHistory });

	const contextValue = useMemo(
		() => ({ cwd, knowledgeHistory }),
		[cwd, knowledgeHistory],
	);

	return (
		<ActivityPanelContextProvider value={contextValue}>
			<ActivityTabMetaHost definitions={definitions}>
				{(metaById) => (
					<ActivityPanelWithMeta
						cwd={cwd}
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
