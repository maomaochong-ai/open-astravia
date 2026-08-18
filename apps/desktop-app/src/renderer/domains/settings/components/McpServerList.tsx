import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import { SegmentedControl } from "@vetta/theme-ui/shared";
import { BuiltinMcpSection } from "./BuiltinMcpSection";
import { McpServerRow } from "./McpServerRow";
import {
	RemoteMcpDiscoverList,
	RemoteMcpRefreshButton,
	useRemoteMcpSectionModel,
	type RemoteMcpSectionModel,
} from "./RemoteMcpSection";
import type { McpSettingsModel } from "./useMcpSettingsModel";

type McpStoreTab = "mine" | "discover";

const MCP_GRID_CLASS = "grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2.5";

/** name → 已解析的绝对图标 URL（来自远程市场） */
function useMarketIconByName(remoteModel: RemoteMcpSectionModel): Map<string, string> {
	return useMemo(() => {
		const map = new Map<string, string>();
		for (const item of remoteModel.items ?? []) {
			const icon = item.icon?.trim();
			if (icon) map.set(item.name, icon);
		}
		return map;
	}, [remoteModel.items]);
}

/** 已添加 MCP 宫格（「我的」）：本地 icon 优先，缺省用市场图标。 */
function McpMineGrid({
	model,
	marketIconByName,
}: {
	model: McpSettingsModel;
	marketIconByName: Map<string, string>;
}): JSX.Element {
	const { t } = useTranslation("settings");
	const names = model.serverNames;
	const section = SETTINGS_SECTION["mcp-server-list-builtin"];

	return (
		<section
			id={section.id}
			data-setting-section-id={section.id}
			data-setting-section-highlight-target={section.id}
		>
			{names.length === 0 ? (
				<div className="rounded-xl bg-card px-5 py-10 text-center text-[12px] text-muted-foreground">
					{t("mcpStore.installedEmpty")}
				</div>
			) : (
				<div className={MCP_GRID_CLASS}>
					{names.map((name) => (
						<McpServerRow
							key={name}
							name={name}
							model={model}
							marketIcon={marketIconByName.get(name)}
						/>
					))}
				</div>
			)}
		</section>
	);
}

/** 发现：上方推荐 + 下方广场（远程）。 */
function McpDiscoverBody({
	model,
	remoteModel,
}: {
	model: McpSettingsModel;
	remoteModel: RemoteMcpSectionModel;
}): JSX.Element {
	const { t } = useTranslation("settings");

	return (
		<div className="flex flex-col gap-8">
			<section>
				<div className="mb-3 min-w-0">
					<div className="text-[13px] font-semibold text-foreground">{t("mcpStore.sectionRecommended")}</div>
					<p className="mt-0.5 text-[11px] text-muted-foreground">{t("mcpStore.sectionRecommendedHint")}</p>
				</div>
				<BuiltinMcpSection
					variant="discover"
					addedNames={model.addedServerNames}
					onAdd={(preset) => {
						void model.onAddBuiltinServer(preset);
					}}
					onRemove={model.onRemoveRemoteServer}
					busyName={model.busyPresetName}
				/>
			</section>

			<section>
				<div className="mb-3 flex flex-wrap items-center justify-between gap-3">
					<div className="min-w-0">
						<div className="text-[13px] font-semibold text-foreground">{t("mcpStore.sectionMarketplace")}</div>
						<p className="mt-0.5 text-[11px] text-muted-foreground">{t("mcpStore.sectionMarketplaceHint")}</p>
					</div>
					<RemoteMcpRefreshButton model={remoteModel} />
				</div>
				<RemoteMcpDiscoverList model={remoteModel} addedNames={model.addedServerNames} />
			</section>
		</div>
	);
}

/**
 * 连接器统一列表：右侧 Toggle「发现 | 我的」。
 * - 发现：上推荐 / 下广场（远程）；已添加项仍展示并标「已添加」
 * - 我的：已添加 MCP（图标来自本地 mcp.json 或远程市场补全）
 */
export function McpStorePanel({ model }: { model: McpSettingsModel }): JSX.Element {
	const { t } = useTranslation("settings");
	const [tab, setTab] = useState<McpStoreTab>("discover");

	// 广场与「我的」共用一份市场数据，保证两侧图标一致
	const remoteModel = useRemoteMcpSectionModel({
		onAdd: model.onAddRemoteServer,
		onRemove: model.onRemoveRemoteServer,
	});
	const marketIconByName = useMarketIconByName(remoteModel);

	// 已添加但尚未写入 icon 的条目：用市场图标回写到本地，刷新后仍可见
	useEffect(() => {
		const config = model.config;
		if (!config || marketIconByName.size === 0) return;
		let changed = false;
		const nextServers = { ...config.mcpServers };
		for (const [name, icon] of marketIconByName) {
			const existing = nextServers[name];
			if (!existing) continue;
			if (existing.icon?.trim()) continue;
			nextServers[name] = { ...existing, icon };
			changed = true;
		}
		if (!changed) return;
		void model.saveConfig({ ...config, mcpServers: nextServers });
	}, [marketIconByName, model.config, model.saveConfig]);

	return (
		<section>
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<div className="min-w-0">
					<div className="text-[15px] font-semibold text-foreground">
						{tab === "mine" ? t("mcpStore.mineTitle") : t("mcpStore.discoverTitle")}
					</div>
					<p className="mt-0.5 text-[11px] text-muted-foreground">
						{tab === "mine" ? t("mcpStore.mineHint") : t("mcpStore.discoverHint")}
					</p>
				</div>
				<SegmentedControl
					items={[
						{ key: "discover" as McpStoreTab, label: t("mcpStore.tabDiscover") },
						{ key: "mine" as McpStoreTab, label: t("mcpStore.tabMine") },
					]}
					value={tab}
					onChange={setTab}
				/>
			</div>

			{tab === "discover" ? (
				<McpDiscoverBody model={model} remoteModel={remoteModel} />
			) : (
				<McpMineGrid model={model} marketIconByName={marketIconByName} />
			)}
		</section>
	);
}

/** @deprecated 使用 McpStorePanel；保留 re-export 以免外部残留引用。 */
export function McpInstalledList({ model }: { model: McpSettingsModel }): JSX.Element {
	const remoteModel = useRemoteMcpSectionModel({
		onAdd: model.onAddRemoteServer,
		onRemove: model.onRemoveRemoteServer,
	});
	return <McpMineGrid model={model} marketIconByName={useMarketIconByName(remoteModel)} />;
}

/** @deprecated 使用 McpStorePanel */
export function McpDiscoverSection({ model }: { model: McpSettingsModel }): JSX.Element {
	const remoteModel = useRemoteMcpSectionModel({
		onAdd: model.onAddRemoteServer,
		onRemove: model.onRemoveRemoteServer,
	});
	return <McpDiscoverBody model={model} remoteModel={remoteModel} />;
}
