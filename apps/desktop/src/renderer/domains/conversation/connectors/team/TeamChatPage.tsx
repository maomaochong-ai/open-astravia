import { Button } from "@shared/components/ui/button";
import { useAgentTeamSidebarSelection } from "@shared/agent-teams/useAgentTeamSidebarSelection";
import {
	activityPanelOpenAtom,
	pageHeaderLeftSlotAtom,
	pageHeaderRightSlotAtom,
	pageHeaderTitleAtom,
	pageHeaderTitleBadgeAtom,
} from "@shared/store/atoms";
import { AgentAvatarView, ChatHeaderActions } from "@vetta/theme-ui/chat";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useAtom, useSetAtom } from "jotai";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useTeamChatModel } from "./useTeamChatModel";
import { TeamChatView } from "./TeamChatView";

export function TeamChatPage({ createNewSession = false }: { readonly createNewSession?: boolean }): JSX.Element {
	const { t } = useTranslation("agent-teams");
	useAgentTeamSidebarSelection();
	const navigate = useNavigate();
	const { teamId, sessionId, memberId } = useParams({ strict: false });
	if (!teamId) throw new Error("Team route is missing teamId");
	const setHeaderTitle = useSetAtom(pageHeaderTitleAtom);
	const setHeaderTitleBadge = useSetAtom(pageHeaderTitleBadgeAtom);
	const setHeaderLeft = useSetAtom(pageHeaderLeftSlotAtom);
	const setHeaderRight = useSetAtom(pageHeaderRightSlotAtom);
	const { model, actions } = useTeamChatModel(teamId, sessionId, memberId, createNewSession);
	const [activityOpen, setActivityOpen] = useAtom(activityPanelOpenAtom);
	const activeSessionTitle = model.sessions.find((session) => session.id === model.activeSessionId)?.label;
	const backToTeamAction = useMemo(
		() =>
			memberId ? (
				<Button
					variant="ghost"
					size="icon-xs"
					className="mr-1"
					title={t("chat.backToTeam")}
					aria-label={t("chat.backToTeam")}
					data-team-session-back="true"
					onClick={() => {
						if (!sessionId) return;
						void navigate({
							to: "/agent-teams/$teamId/sessions/$sessionId",
							params: { teamId, sessionId },
						});
					}}
				>
					<span className="icon-[solar--arrow-left-linear] h-3.5 w-3.5" aria-hidden="true" />
				</Button>
			) : null,
		[memberId, navigate, sessionId, t, teamId],
	);
	const memberHeader = useMemo(
		() => (
			<div className="flex min-w-0 items-center gap-0.5" role="group" aria-label={t("chat.memberSessions")}>
				{model.members.map((member) => {
					const memberRuntimeId = model.memberRuntimeIds?.[member.id];
					return (
						<Button
							key={member.id}
							variant="ghost"
							size="icon-xs"
							className="h-7 w-7 rounded-full p-0"
							disabled={!memberRuntimeId}
							data-member-session-id={member.id}
							data-member-session-active={member.id === memberId ? "true" : undefined}
							aria-label={t("chat.memberSession", { name: member.name })}
							title={t("chat.memberSession", { name: member.name })}
							onClick={() => {
								if (!memberRuntimeId || !sessionId) return;
								void navigate({
									to: "/agent-teams/$teamId/sessions/$sessionId/members/$memberId",
									params: { teamId, sessionId, memberId: member.id },
								});
							}}
						>
							<AgentAvatarView
								name={member.name}
								avatar={member.avatar}
								blueprintId={member.blueprintId}
								active={member.id === memberId}
								size="xs"
							/>
						</Button>
					);
				})}
			</div>
		),
		[memberId, model.memberRuntimeIds, model.members, navigate, sessionId, t, teamId],
	);

	useEffect(() => {
		if (sessionId || !model.activeSessionId) return;
		void navigate({
			to: "/agent-teams/$teamId/sessions/$sessionId",
			params: { teamId, sessionId: model.activeSessionId },
			replace: true,
		});
	}, [model.activeSessionId, navigate, sessionId, teamId]);

	const headerActions = useMemo(
		() => (
			<>
				<ChatHeaderActions.Panel
					title={t("chat.activity")}
					open={activityOpen}
					onClick={() => setActivityOpen((open) => !open)}
				/>
				<Button
					variant="ghost"
					size="icon-xs"
					title={t("chat.configure")}
					aria-label={t("chat.configure")}
					onClick={() => {
						void navigate({
							to: "/agent-teams/$teamId/settings",
							params: { teamId },
						});
					}}
				>
					<span className="icon-[solar--settings-linear] h-3.5 w-3.5" aria-hidden="true" />
				</Button>
			</>
		),
		[activityOpen, navigate, setActivityOpen, t, teamId],
	);

	useEffect(() => {
		setHeaderLeft(backToTeamAction);
		setHeaderTitle(activeSessionTitle ?? model.title);
		setHeaderTitleBadge(memberHeader);
		setHeaderRight(headerActions);
		return () => {
			setHeaderLeft(null);
			setHeaderTitle(null);
			setHeaderTitleBadge(null);
			setHeaderRight(null);
		};
	}, [activeSessionTitle, backToTeamAction, headerActions, memberHeader, model.title, setHeaderLeft, setHeaderRight, setHeaderTitle, setHeaderTitleBadge]);

	return <TeamChatView model={model} actions={actions} />;
}

export function TeamNewSessionPage(): JSX.Element {
	return <TeamChatPage createNewSession />;
}
