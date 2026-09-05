import { teamDisplayName } from "@shared/agent-teams/agent-team-presentation";
import { TEAM_SESSIONS_CHANGED_EVENT } from "@shared/agent-teams/team-session-events";
import { Button } from "@shared/components/ui/button";
import { agentAvatarUrl } from "@shared/agent-teams/agent-avatar";
import type { AgentTeamDocument, TeamSessionListItem } from "@vetta/agent-team";
import { useMatches, useNavigate } from "@tanstack/react-router";
import { DefaultSessionRowView } from "@vetta/theme-ui/project";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const CONFIGURATION_CHANGED_EVENT = "vetta:agent-team-configuration-changed";

export function AgentTeamSidebarList(): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const navigate = useNavigate();
	const matches = useMatches();
	const currentPath = matches[matches.length - 1]?.pathname ?? "";
	const [document, setDocument] = useState<AgentTeamDocument>();
	const [sessionsByTeam, setSessionsByTeam] = useState<Readonly<Record<string, readonly TeamSessionListItem[]>>>({});
	const [error, setError] = useState(false);

	useEffect(() => {
		let active = true;
		const loadAll = (): void => {
			void window.vetta.agentTeams
				.list()
				.then(async (next) => ({
					document: next,
					sessions: Object.fromEntries(
						await Promise.all(
							next.teams.map(async (team) => [team.id, await window.vetta.agentTeams.listSessions(team.id)] as const),
						),
					),
				}))
				.then((next) => {
					if (!active) return;
					setDocument(next.document);
					setSessionsByTeam(next.sessions);
					setError(false);
				})
				.catch(() => {
					if (active) setError(true);
				});
		};
		const refreshChangedTeam = (event: Event): void => {
			const teamId = event instanceof CustomEvent ? (event.detail as { teamId?: unknown }).teamId : undefined;
			if (typeof teamId !== "string" || teamId.length === 0) {
				loadAll();
				return;
			}
			void window.vetta.agentTeams
				.listSessions(teamId)
				.then((sessions) => {
					if (!active) return;
					setSessionsByTeam((current) => ({ ...current, [teamId]: sessions }));
					setError(false);
				})
				.catch(() => {
					if (active) setError(true);
				});
		};
		loadAll();
		window.addEventListener(CONFIGURATION_CHANGED_EVENT, loadAll);
		window.addEventListener(TEAM_SESSIONS_CHANGED_EVENT, refreshChangedTeam);
		return () => {
			active = false;
			window.removeEventListener(CONFIGURATION_CHANGED_EVENT, loadAll);
			window.removeEventListener(TEAM_SESSIONS_CHANGED_EVENT, refreshChangedTeam);
		};
	}, []);

	const activeTeamId = useMemo(() => teamIdFromPath(currentPath), [currentPath]);
	const activeSessionId = useMemo(() => sessionIdFromPath(currentPath), [currentPath]);
	const creatingNewSession = useMemo(() => isNewSessionPath(currentPath), [currentPath]);
	const agentsById = useMemo(() => new Map(document?.agents.map((agent) => [agent.id, agent]) ?? []), [document?.agents]);
	if (error) {
		return <p className="px-2.5 py-3 text-[11px] text-destructive">{t("sidebar.loadError")}</p>;
	}
	if (!document) {
		return (
			<div className="space-y-1 px-2.5 py-2" aria-label={t("loading")}>
				<div className="h-7 animate-pulse rounded-md bg-muted/50" />
				<div className="h-7 animate-pulse rounded-md bg-muted/30" />
			</div>
		);
	}
	if (document.teams.length === 0) {
		return <p className="px-2.5 py-3 text-[11px] text-muted-foreground">{t("sidebar.empty")}</p>;
	}

	return (
		<div className="project-list-containment -mx-1.5 space-y-px px-1.5">
			{document.teams.map((team) => {
				const sessions = sessionsByTeam[team.id] ?? [];
				const isCreatingThisTeam = creatingNewSession && team.id === activeTeamId;
				return (
					<div key={team.id}>
						<div className="group relative">
							<DefaultSessionRowView
							active={team.id === activeTeamId && !activeSessionId && !isCreatingThisTeam}
							contextMenuEnabled={false}
							iconClassName="icon-[solar--users-group-rounded-linear]"
							leadingAvatarUrls={team.members.map((member) => {
								const profile = agentsById.get(member.binding.agentProfileId);
								return agentAvatarUrl({
									id: profile?.id ?? member.id,
									blueprintId: profile?.blueprintId ?? "leader",
									...(profile?.avatar ? { avatar: profile.avatar } : {}),
								});
							})}
							label={teamDisplayName(team, t)}
							renaming={false}
							running={false}
							scheduled={false}
							timeLabel=""
							onOpenContextMenu={() => undefined}
							onRename={() => undefined}
							onRenameDone={() => undefined}
							onSelect={() => {
								void navigate(
									sessions.length > 0
										? { to: "/agent-teams/$teamId", params: { teamId: team.id } }
										: { to: "/agent-teams/$teamId/new", params: { teamId: team.id } },
								);
							}}
						/>
							<Button
								variant="ghost"
								size="icon-xs"
								className="absolute inset-y-0 right-1 my-auto bg-background opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
								title={t("chat.newSession")}
								aria-label={t("chat.newSession")}
								onClick={() => {
									void navigate({
										to: "/agent-teams/$teamId/new",
										params: { teamId: team.id },
									});
								}}
							>
								<span className="icon-[solar--add-circle-linear] h-3.5 w-3.5" aria-hidden="true" />
							</Button>
						</div>
						{isCreatingThisTeam || sessions.length > 0 ? (
							<div className="ml-4 border-l border-border/50 pl-1">
								{isCreatingThisTeam ? (
									<DefaultSessionRowView
										active
										contextMenuEnabled={false}
										label={t("chat.newSession")}
										renaming={false}
										running={false}
										scheduled={false}
										timeLabel=""
										onOpenContextMenu={() => undefined}
										onRename={() => undefined}
										onRenameDone={() => undefined}
										onSelect={() => undefined}
									/>
								) : null}
								{sessions.map((session, index) => (
									<DefaultSessionRowView
										key={session.id}
										active={session.id === activeSessionId}
										contextMenuEnabled={false}
										label={t("chat.sessionLabel", { index: sessions.length - index })}
										renaming={false}
										running={false}
										scheduled={false}
										timeLabel=""
										onOpenContextMenu={() => undefined}
										onRename={() => undefined}
										onRenameDone={() => undefined}
										onSelect={() => {
											void navigate({
												to: "/agent-teams/$teamId/sessions/$sessionId",
												params: { teamId: team.id, sessionId: session.id },
											});
										}}
									/>
								))}
							</div>
						) : null}
					</div>
				);
			})}
		</div>
	);
}

export function notifyAgentTeamConfigurationChanged(): void {
	window.dispatchEvent(new Event(CONFIGURATION_CHANGED_EVENT));
}

function teamIdFromPath(path: string): string | undefined {
	const match = /^\/agent-teams\/([^/]+)(?:\/new|\/settings|\/sessions\/[^/]+(?:\/members\/[^/]+)?)?$/.exec(path);
	return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function isNewSessionPath(path: string): boolean {
	return /^\/agent-teams\/[^/]+\/new$/.test(path);
}

function sessionIdFromPath(path: string): string | undefined {
	const match = /^\/agent-teams\/[^/]+\/sessions\/([^/]+)(?:\/members\/[^/]+)?$/.exec(path);
	return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}
