import type { MarketMcpServer } from "@shared/lib/api";
import {
	RemoteMcpSectionView as ThemeRemoteMcpSectionView,
	type RemoteMcpSectionViewLabels,
	type RemoteMcpServerRowView,
} from "@vetta/theme-ui/settings";
import { SETTINGS_SECTION } from "../registry";
import type { RemoteMcpSectionModel } from "./useRemoteMcpSectionModel";

export type { RemoteMcpSectionViewLabels };

export interface RemoteMcpSectionViewProps {
	readonly addedNames: Set<string>;
	readonly discover?: boolean;
	readonly labels: RemoteMcpSectionViewLabels;
	readonly model: RemoteMcpSectionModel;
	readonly showHeader?: boolean;
}

export function RemoteMcpSectionView({
	addedNames,
	discover = false,
	labels,
	model,
	showHeader = true,
}: RemoteMcpSectionViewProps): JSX.Element {
	return (
		<ThemeRemoteMcpSectionView
			addedNames={addedNames}
			discover={discover}
			labels={labels}
			showHeader={showHeader}
			remoteSection={SETTINGS_SECTION["mcp-remote-available"]}
			model={{
				items: model.items,
				loading: model.loading,
				error: model.error,
				busy: model.busy,
				load: model.load,
				handleAction: async (server: RemoteMcpServerRowView, action) => {
					const full =
						model.items?.find((item) => item.name === server.name) ??
						(server as unknown as MarketMcpServer);
					await model.handleAction(full, action);
				},
			}}
		/>
	);
}
