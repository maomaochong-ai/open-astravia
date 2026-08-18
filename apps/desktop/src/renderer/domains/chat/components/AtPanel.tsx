import { useThemeComponent } from "@vetta/theme-sdk";
import { useAtPanelModel } from "../hooks/useAtPanelModel";
import { AtPanelView } from "./at-panel/AtPanelView";
import type { AtPanelProps } from "./at-panel/types";

export function AtPanel(props: AtPanelProps): JSX.Element {
	const model = useAtPanelModel(props);
	const ThemedAtPanelView = useThemeComponent("chat.atPanelView", AtPanelView);
	if (model.hidden) return <></>;
	return <ThemedAtPanelView {...model.viewProps} />;
}

export type { AtPanelProps, AtPanelViewProps, SelectedFile } from "./at-panel/types";
