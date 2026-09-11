import { teamMemberAvatarUrls, useAgentAvatarResolver } from "@shared/agent-teams/agent-avatar";
import { BotAvatar } from "@shared/components/BotAvatar";
import { type AgentTeamDocument, listLibraryAgentProfiles } from "@vetta/agent-team";
import { NewSessionPicker, type NewSessionPickerRootProps } from "@vetta/theme-ui/chat";
import { AvatarStackView } from "@vetta/theme-ui/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadAgentTeamDocument } from "./agent-team-directory";
import {
	agentTargetKey,
	filterTargetOptions,
	type NewSessionTargetKey,
	type NewSessionTargetOption,
	teamTargetKey,
} from "./target";

export interface NewSessionAgentSelectorProps {
	readonly selectedKey: NewSessionTargetKey | null;
	readonly onSelect: (targetKey: NewSessionTargetKey | null) => void;
	readonly className?: string;
}

const SEARCH_THRESHOLD = 5;

/**
 * 「切换智能体」入口：未选时是 BotAvatar + 文案的 chip，选中后原地变成头像（团队是成员头像组、
 * 单个智能体是它自己的头像）+ 名字，再次点击可换。下拉里团队与智能体分两组，
 * 搜索一次跨两组过滤。三枚 chip 行为与同一行的项目/模式选择器一致。
 */
export function NewSessionAgentSelector({
	selectedKey,
	onSelect,
	className,
}: NewSessionAgentSelectorProps): JSX.Element {
	const { t } = useTranslation("chat");
	const [document, setDocument] = useState<AgentTeamDocument>();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			setDocument(await loadAgentTeamDocument());
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setLoading(false);
		}
	}, []);

	const agentsById = useMemo(
		() => new Map(document?.agents.map((agent) => [agent.id, agent]) ?? []),
		[document?.agents],
	);
	useEffect(() => {
		void load();
	}, [load]);
	const resolveAvatar = useAgentAvatarResolver();
	const blueprintAvatars = useMemo(
		() => new Map(document?.agents.map((agent) => [agent.blueprintId, { avatarUrl: resolveAvatar(agent) }]) ?? []),
		[document?.agents, resolveAvatar],
	);

	const teamOptions = useMemo<readonly NewSessionTargetOption[]>(
		() =>
			(document?.teams ?? []).map((team) => ({
				targetKey: teamTargetKey(team.id),
				title: team.name,
				subtitle: t("newSession.agentSelector.memberCount", { count: team.members.length }),
				avatarUrls: teamMemberAvatarUrls(team, agentsById, blueprintAvatars),
				selected: selectedKey === teamTargetKey(team.id),
			})),
		[agentsById, blueprintAvatars, document?.teams, selectedKey, t],
	);
	// 只列智能体库里的 Agent：团队 `copy` 绑定产生的 team scope 副本是团队私有的，
	// 摆进来会变成一堆同名影子条目。
	const agentOptions = useMemo<readonly NewSessionTargetOption[]>(
		() =>
			(document ? listLibraryAgentProfiles(document) : []).map((agent) => ({
				targetKey: agentTargetKey(agent.id),
				title: agent.name,
				...(agent.description ? { subtitle: agent.description } : {}),
				avatarUrls: [resolveAvatar(agent)],
				selected: selectedKey === agentTargetKey(agent.id),
			})),
		[document, resolveAvatar, selectedKey],
	);
	const visibleTeams = useMemo(() => filterTargetOptions(teamOptions, query), [teamOptions, query]);
	const visibleAgents = useMemo(() => filterTargetOptions(agentOptions, query), [agentOptions, query]);
	const selectedOption = [...teamOptions, ...agentOptions].find((option) => option.targetKey === selectedKey);
	const searchVisible = teamOptions.length + agentOptions.length > SEARCH_THRESHOLD;
	const nothingVisible = visibleTeams.length === 0 && visibleAgents.length === 0;

	const handleOpenChange: NonNullable<NewSessionPickerRootProps["onOpenChange"]> = useCallback((next) => {
		setOpen(next);
		if (!next) setQuery("");
	}, []);
	const handleSelect = useCallback(
		(next: string | null) => {
			onSelect(next as NewSessionTargetKey | null);
			handleOpenChange(false);
		},
		[handleOpenChange, onSelect],
	);

	const triggerLabel = selectedOption
		? t("newSession.agentSelector.switchTitle")
		: t("newSession.agentSelector.pickTitle");

	const renderOption = (option: NewSessionTargetOption): JSX.Element => (
		<NewSessionPicker.Item key={option.targetKey} value={option.targetKey}>
			{option.avatarUrls?.length ? (
				<AvatarStackView avatarUrls={option.avatarUrls} />
			) : (
				<NewSessionPicker.ItemIcon>
					<span className="icon-[solar--users-group-rounded-linear]" />
				</NewSessionPicker.ItemIcon>
			)}
			<NewSessionPicker.ItemText>
				<span className="flex min-w-0 flex-col">
					<span className="truncate">{option.title}</span>
					{option.subtitle && (
						<span className="truncate text-[11px] font-normal text-muted-foreground/70">{option.subtitle}</span>
					)}
				</span>
			</NewSessionPicker.ItemText>
			{option.selected && <NewSessionPicker.ItemIndicator />}
		</NewSessionPicker.Item>
	);

	return (
		<NewSessionPicker.Root
			open={open}
			onOpenChange={handleOpenChange}
			value={selectedKey}
			onValueChange={handleSelect}
		>
			{/* BotAvatar 自身是 <button>，套在默认 button 触发器里会被 HTML 解析器提前闭合，
			    因此这里用 asChild + div 手写键盘行为。 */}
			<NewSessionPicker.Trigger
				asChild
				className={className}
				aria-label={triggerLabel}
				title={selectedOption?.title ?? triggerLabel}
			>
				<div
					role="button"
					tabIndex={0}
					className="cursor-pointer"
					onKeyDown={(event) => {
						if (event.key !== "Enter" && event.key !== " ") return;
						event.preventDefault();
						handleOpenChange(true);
					}}
				>
					{selectedOption?.avatarUrls?.length ? (
						<AvatarStackView avatarUrls={selectedOption.avatarUrls} />
					) : (
						<BotAvatar size="sm" className="pointer-events-none -ml-1" />
					)}
					<span className="min-w-0 truncate">{selectedOption?.title ?? t("newSession.agentSelector.pick")}</span>
					<span className="icon-[solar--alt-arrow-down-linear] h-3 w-3 shrink-0 opacity-70" aria-hidden />
				</div>
			</NewSessionPicker.Trigger>
			<NewSessionPicker.Content>
				{searchVisible && (
					<NewSessionPicker.Search
						value={query}
						onValueChange={setQuery}
						placeholder={t("newSession.agentSelector.searchPlaceholder")}
					/>
				)}
				<NewSessionPicker.Viewport>
					{selectedKey && <NewSessionPicker.Clear>{t("newSession.agentSelector.clear")}</NewSessionPicker.Clear>}
					{loading ? (
						<NewSessionPicker.Loading>{t("newSession.agentSelector.loading")}</NewSessionPicker.Loading>
					) : error ? (
						<>
							<NewSessionPicker.Error>{t("newSession.agentSelector.error")}</NewSessionPicker.Error>
							<button
								type="button"
								className="flex w-full items-center rounded-md px-2 py-[5px] text-left text-[12px] text-foreground hover:bg-accent"
								onClick={() => void load()}
							>
								{t("newSession.agentSelector.retry")}
							</button>
						</>
					) : nothingVisible ? (
						<NewSessionPicker.Group>
							<NewSessionPicker.Empty>{t("newSession.agentSelector.empty")}</NewSessionPicker.Empty>
						</NewSessionPicker.Group>
					) : (
						<>
							{visibleTeams.length > 0 && (
								<NewSessionPicker.Group label={t("newSession.agentSelector.groupTeams")}>
									{visibleTeams.map(renderOption)}
								</NewSessionPicker.Group>
							)}
							{visibleAgents.length > 0 && (
								<NewSessionPicker.Group label={t("newSession.agentSelector.groupAgents")}>
									{visibleAgents.map(renderOption)}
								</NewSessionPicker.Group>
							)}
						</>
					)}
				</NewSessionPicker.Viewport>
			</NewSessionPicker.Content>
		</NewSessionPicker.Root>
	);
}
