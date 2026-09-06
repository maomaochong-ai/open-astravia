import type { AgentTeamDocument } from "@vetta/agent-team";
import { teamMemberAvatarUrls } from "@shared/agent-teams/agent-avatar";
import {
	NewSessionPicker,
	type NewSessionPickerRootProps,
} from "@vetta/theme-ui/chat";
import { AvatarStackView } from "@vetta/theme-ui/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	filterTargetOptions,
	teamTargetKey,
	type NewSessionTargetKey,
	type NewSessionTargetOption,
} from "./target";

export interface NewSessionTeamSelectorProps {
	readonly selectedKey: NewSessionTargetKey | null;
	readonly onSelect: (targetKey: NewSessionTargetKey | null) => void;
	readonly className?: string;
}

const SEARCH_THRESHOLD = 5;

export function NewSessionTeamSelector({ selectedKey, onSelect, className }: NewSessionTeamSelectorProps): JSX.Element {
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
			setDocument(await window.vetta.agentTeams.list());
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

	const options = useMemo<readonly NewSessionTargetOption[]>(
		() =>
			(document?.teams ?? []).map((team) => ({
				targetKey: teamTargetKey(team.id),
					title: team.name,
					subtitle: t("newSession.teamSelector.memberCount", { count: team.members.length }),
					avatarUrls: teamMemberAvatarUrls(team, agentsById),
					selected: selectedKey === teamTargetKey(team.id),
				})),
		[agentsById, document?.teams, selectedKey, t],
	);
	const visibleOptions = useMemo(() => filterTargetOptions(options, query), [options, query]);
	const selectedOption = options.find((option) => option.targetKey === selectedKey);
	const searchVisible = options.length > SEARCH_THRESHOLD;

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

	return (
		<NewSessionPicker.Root
			open={open}
			onOpenChange={handleOpenChange}
			value={selectedKey}
			onValueChange={handleSelect}
		>
			<NewSessionPicker.Trigger className={className} aria-label={t("newSession.teamSelector.triggerTitle")}>
				{selectedOption?.avatarUrls?.length ? (
					<AvatarStackView avatarUrls={selectedOption.avatarUrls} />
				) : (
					<span className="icon-[solar--users-group-rounded-linear] h-3.5 w-3.5 shrink-0" aria-hidden />
				)}
				<span
					className="min-w-0 truncate"
					title={selectedOption?.title ?? t("newSession.teamSelector.triggerTitle")}
				>
					{selectedOption?.title ?? t("newSession.teamSelector.placeholder")}
				</span>
				<span className="icon-[solar--alt-arrow-down-linear] h-3 w-3 shrink-0 opacity-70" aria-hidden />
			</NewSessionPicker.Trigger>
			<NewSessionPicker.Content>
				{searchVisible && (
					<NewSessionPicker.Search
						value={query}
						onValueChange={setQuery}
						placeholder={t("newSession.teamSelector.searchPlaceholder")}
					/>
				)}
				<NewSessionPicker.Viewport>
					{selectedKey && <NewSessionPicker.Clear>{t("newSession.teamSelector.clear")}</NewSessionPicker.Clear>}
					{loading ? (
						<NewSessionPicker.Loading>{t("newSession.teamSelector.loading")}</NewSessionPicker.Loading>
					) : error ? (
						<>
							<NewSessionPicker.Error>{t("newSession.teamSelector.error")}</NewSessionPicker.Error>
							<button
								type="button"
								className="flex w-full items-center rounded-md px-2 py-[5px] text-left text-[12px] text-foreground hover:bg-accent"
								onClick={() => void load()}
							>
								{t("newSession.teamSelector.retry")}
							</button>
						</>
					) : (
						<NewSessionPicker.Group>
							{visibleOptions.length === 0 ? (
								<NewSessionPicker.Empty>{t("newSession.teamSelector.empty")}</NewSessionPicker.Empty>
							) : (
								visibleOptions.map((option) => (
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
												{option.subtitle && <span className="truncate text-[11px] font-normal text-muted-foreground/70">{option.subtitle}</span>}
											</span>
										</NewSessionPicker.ItemText>
										{option.selected && <NewSessionPicker.ItemIndicator />}
									</NewSessionPicker.Item>
								))
							)}
						</NewSessionPicker.Group>
					)}
				</NewSessionPicker.Viewport>
			</NewSessionPicker.Content>
		</NewSessionPicker.Root>
	);
}
