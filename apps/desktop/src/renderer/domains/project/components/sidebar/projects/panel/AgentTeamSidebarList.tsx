import type { AgentTeamDocument } from "@vetta/agent-team";
import { useMatches, useNavigate } from "@tanstack/react-router";
import { DefaultSessionRowView } from "@vetta/theme-ui/project";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { teamDisplayName } from "../../../../../agent-teams/lib/preset-presentation";

const CONFIGURATION_CHANGED_EVENT = "vetta:agent-team-configuration-changed";

export function AgentTeamSidebarList(): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const navigate = useNavigate();
	const matches = useMatches();
	const currentPath = matches[matches.length - 1]?.pathname ?? "";
	const [document, setDocument] = useState<AgentTeamDocument>();
	const [error, setError] = useState(false);

	useEffect(() => {
		let active = true;
		const load = (): void => {
			void window.vetta.agentTeams
				.list()
				.then((next) => {
					if (!active) return;
					setDocument(next);
					setError(false);
				})
				.catch(() => {
					if (active) setError(true);
				});
		};
		load();
		window.addEventListener(CONFIGURATION_CHANGED_EVENT, load);
		return () => {
			active = false;
			window.removeEventListener(CONFIGURATION_CHANGED_EVENT, load);
		};
	}, []);

	const activeTeamId = useMemo(() => teamIdFromPath(currentPath), [currentPath]);
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
			{document.teams.map((team) => (
				<DefaultSessionRowView
					key={team.id}
					active={team.id === activeTeamId}
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
			))}
		</div>
	);
}

export function notifyAgentTeamConfigurationChanged(): void {
	window.dispatchEvent(new Event(CONFIGURATION_CHANGED_EVENT));
}

function teamIdFromPath(path: string): string | undefined {
	const match = /^\/agent-teams\/([^/]+)(?:\/settings)?$/.exec(path);
	return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}
