import { teamDisplayName } from "@shared/agent-teams/preset-presentation";
import { TEAM_SESSIONS_CHANGED_EVENT } from "@shared/agent-teams/team-session-events";
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
		const load = (): void => {
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
		load();
		window.addEventListener(CONFIGURATION_CHANGED_EVENT, load);
		window.addEventListener(TEAM_SESSIONS_CHANGED_EVENT, load);
		return () => {
			active = false;
			window.removeEventListener(CONFIGURATION_CHANGED_EVENT, load);
			window.removeEventListener(TEAM_SESSIONS_CHANGED_EVENT, load);
		};
	}, []);

	const activeTeamId = useMemo(() => teamIdFromPath(currentPath), [currentPath]);
	const activeSessionId = useMemo(() => sessionIdFromPath(currentPath), [currentPath]);
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
				return (
					<div key={team.id}>
						<DefaultSessionRowView
							active={team.id === activeTeamId && !activeSessionId}
							contextMenuEnabled={false}
							iconClassName="icon-[solar--users-group-rounded-linear]"
							label={teamDisplayName(team, t)}
							renaming={false}
							running={false}
							scheduled={false}
							timeLabel={t("sidebar.memberCount", { count: team.members.length })}
							onOpenContextMenu={() => undefined}
							onRename={() => undefined}
							onRenameDone={() => undefined}
							onSelect={() => {
								void navigate({
									to: "/agent-teams/$teamId",
									params: { teamId: team.id },
								});
							}}
						/>
						{sessions.length > 0 ? (
							<div className="ml-4 border-l border-border/50 pl-1">
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
	const match = /^\/agent-teams\/([^/]+)(?:\/settings|\/sessions\/[^/]+)?$/.exec(path);
	return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function sessionIdFromPath(path: string): string | undefined {
	const match = /^\/agent-teams\/[^/]+\/sessions\/([^/]+)$/.exec(path);
	return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}
