import type { MarketMcpServer } from "@shared/lib/api";
import { Button, cn } from "@vetta/ui";
import { RemoteMcpSectionView } from "@vetta/theme-ui/settings";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import {
	type RemoteMcpSectionModel,
	useRemoteMcpSectionModel,
} from "./useRemoteMcpSectionModel";

export type { RemoteMcpSectionModel };
export { useRemoteMcpSectionModel };

function useRemoteMcpLabels() {
	const { t } = useTranslation("settings");
	return {
		add: t("add"),
		added: t("added"),
		loading: t("loading"),
		noRemoteMcp: t("noRemoteMcp"),
		processing: t("processing"),
		refresh: t("refresh"),
		remoteAllAdded: t("mcpStore.remoteAllAdded"),
		remoteListTitle: t("section_mcp-remote-list"),
		remoteSupport: t("remoteMcpSupport"),
		remove: t("remove"),
	};
}

function toThemeModel(model: RemoteMcpSectionModel) {
	return {
		items: model.items,
		loading: model.loading,
		error: model.error,
		busy: model.busy,
		load: model.load,
		handleAction: async (
			server: { name: string },
			action: "add" | "remove",
		): Promise<void> => {
			const full =
				model.items?.find((item) => item.name === server.name) ??
				(server as MarketMcpServer);
			await model.handleAction(full, action);
		},
	};
}

/** 完整区块：自持数据 + 标题行刷新 */
export function RemoteMcpSection({
	addedNames,
	onAdd,
	onRemove,
}: {
	addedNames: Set<string>;
	onAdd: (server: MarketMcpServer) => Promise<void> | void;
	onRemove: (name: string) => Promise<void> | void;
}): JSX.Element {
	const model = useRemoteMcpSectionModel({ onAdd, onRemove });
	return (
		<RemoteMcpSectionView
			addedNames={addedNames}
			labels={useRemoteMcpLabels()}
			model={toThemeModel(model)}
			showHeader
			remoteSection={SETTINGS_SECTION["mcp-remote-available"]}
		/>
	);
}

/** 发现 Tab：外层持有 model，刷新放在「发现」标题行 */
export function RemoteMcpDiscoverList({
	model,
	addedNames,
}: {
	model: RemoteMcpSectionModel;
	addedNames: Set<string>;
}): JSX.Element {
	return (
		<RemoteMcpSectionView
			addedNames={addedNames}
			discover
			labels={useRemoteMcpLabels()}
			model={toThemeModel(model)}
			showHeader={false}
			remoteSection={SETTINGS_SECTION["mcp-remote-available"]}
		/>
	);
}

export function RemoteMcpRefreshButton({
	model,
}: {
	model: Pick<RemoteMcpSectionModel, "load" | "loading">;
}): JSX.Element {
	const labels = useRemoteMcpLabels();
	return (
		<Button variant="ghost" size="sm" onClick={model.load} disabled={model.loading} className="shrink-0">
			<span className={cn("icon-[mdi--refresh] mr-1 h-3.5 w-3.5", model.loading && "animate-spin")} />
			{labels.refresh}
		</Button>
	);
}
