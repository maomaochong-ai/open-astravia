import { cn } from "@vetta/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AbilityContributedMcp, AbilityContributedSkill, AbilityType } from "@shared/lib/api";
import type { PluginAbility } from "../../types";
import { AbilityIcon } from "../AbilityIcon";

/** 超过这个条数就折叠，避免插件带一堆 server/skill 时详情页被撑爆。 */
const COLLAPSED_LIMIT = 5;

/**
 * 「本插件提供」：插件内聚的 MCP server 与 skill（ADR-0040 的 agent.mcpServers / agent.skillPaths）。
 *
 * 这些成员随插件生死、对用户不可单独安装卸载（与 bundle 的松散组合相对，见 ADR-0049），
 * 所以必须在**装之前**就列清楚，否则用户无从判断这个插件到底带来了什么。
 *
 * 数据来自服务端上传时对 zip 的解析（market.config.contributions）；
 * 未上架、仅本地安装的插件若用内联 server map 声明，则从 manifest 兜底取名。
 */
export function PluginContributionsSection({ item }: { item: PluginAbility }): JSX.Element | null {
	const { t } = useTranslation("abilities");
	const mcpServers = resolveMcpServers(item);
	const skills = item.market?.config.contributions?.skills ?? [];

	if (mcpServers.length === 0 && skills.length === 0) return null;

	return (
		<div className="flex flex-col gap-3">
			{mcpServers.length > 0 ? (
				<ContributionGroup
					label={t("plugin.contributedMcp")}
					type="mcp"
					items={mcpServers.map((server) => ({
						key: server.name,
						title: server.display_name?.trim() || server.name,
						description: server.description,
					}))}
				/>
			) : null}
			{skills.length > 0 ? (
				<ContributionGroup
					label={t("plugin.contributedSkills")}
					type="skill"
					items={skills.map((skill: AbilityContributedSkill) => ({
						key: skill.name,
						title: skill.alias?.trim() || skill.name,
						description: skill.description,
					}))}
				/>
			) : null}
		</div>
	);
}

interface ContributionEntry {
	key: string;
	title: string;
	description?: string;
	icon?: string;
}

function ContributionGroup({
	label,
	type,
	items,
}: {
	label: string;
	type: AbilityType;
	items: ContributionEntry[];
}): JSX.Element {
	const { t } = useTranslation("abilities");
	const [expanded, setExpanded] = useState(false);
	const collapsible = items.length > COLLAPSED_LIMIT;
	const visible = collapsible && !expanded ? items.slice(0, COLLAPSED_LIMIT) : items;

	return (
		<div>
			<div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground/60">{label}</div>
			{/* 一张卡片装下整组，条目之间只用分隔线 */}
			<div className="overflow-hidden rounded-lg border border-border bg-background/50">
				{visible.map((entry) => (
					<div
						key={entry.key}
						className="flex items-center gap-2.5 border-b border-border/60 px-2.5 py-2 last:border-b-0"
					>
						{/* 与能力广场卡片同一套图标样式：bundle 详情里会引用真实的 skill / mcp */}
						<AbilityIcon icon={entry.icon} type={type} className="h-8 w-8" iconClassName="h-4 w-4" />
						<div className="min-w-0 flex-1">
							<div className="truncate text-[12px] font-medium text-foreground">{entry.title}</div>
							{entry.description ? (
								<div className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
									{entry.description}
								</div>
							) : null}
						</div>
					</div>
				))}
				{collapsible ? (
					<button
						type="button"
						className="flex w-full items-center justify-center gap-1 border-t border-border/60 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
						onClick={() => setExpanded((prev) => !prev)}
					>
						<span
							className={cn(
								"icon-[solar--alt-arrow-down-linear] h-3 w-3 transition-transform",
								expanded && "rotate-180",
							)}
						/>
						{expanded
							? t("plugin.collapseList")
							: t("plugin.expandList", { count: items.length - COLLAPSED_LIMIT })}
					</button>
				) : null}
			</div>
		</div>
	);
}

/**
 * 服务端解析结果优先；缺失时对**内联** server map 兜底取名。
 * 路径式声明（"./.mcp.json"）无法在渲染层解析——那份文件在安装目录里，
 * 渲染进程不读磁盘，故只能依赖服务端解析。
 */
function resolveMcpServers(item: PluginAbility): AbilityContributedMcp[] {
	const fromMarket = item.market?.config.contributions?.mcp_servers;
	if (fromMarket && fromMarket.length > 0) return fromMarket;

	const declared = item.plugin?.agent?.mcpServers;
	if (!declared || typeof declared === "string") return [];
	return Object.entries(declared).map(([name, config]) => ({
		name,
		display_name: typeof config.displayName === "string" ? config.displayName : undefined,
		description: typeof config.description === "string" ? config.description : undefined,
	}));
}
