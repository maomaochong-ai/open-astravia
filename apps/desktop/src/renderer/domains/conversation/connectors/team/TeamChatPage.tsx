import { Button } from "@shared/components/ui/button";
import { activityPanelOpenAtom, pageHeaderRightSlotAtom, pageHeaderTitleAtom } from "@shared/store/atoms";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ChatHeaderActions } from "@vetta/theme-ui/chat";
import { useAtom, useSetAtom } from "jotai";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChatHeaderNewSessionButton } from "../../components/chat-view/ChatHeaderNewSessionButton";
import { useAgentTeamSidebarSelection } from "@shared/agent-teams/useAgentTeamSidebarSelection";
import { useTeamChatModel } from "./useTeamChatModel";
import { TeamChatView } from "./TeamChatView";

export function TeamChatPage(): JSX.Element {
	const { t } = useTranslation("agent-teams");
	useAgentTeamSidebarSelection();
	const navigate = useNavigate();
	const { teamId, sessionId } = useParams({ strict: false });
	if (!teamId) throw new Error("Team route is missing teamId");
	const setHeaderTitle = useSetAtom(pageHeaderTitleAtom);
	const setHeaderRight = useSetAtom(pageHeaderRightSlotAtom);
	const { model, actions } = useTeamChatModel(teamId, sessionId);
	const [activityOpen, setActivityOpen] = useAtom(activityPanelOpenAtom);
	const activeSessionTitle = model.sessions.find((session) => session.id === model.activeSessionId)?.label;

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
				<ChatHeaderNewSessionButton
					alwaysVisible
					title={t("chat.newSession")}
					onClick={() => {
						void actions.createSession().then((createdSessionId) => {
							if (!createdSessionId) return;
							void navigate({
								to: "/agent-teams/$teamId/sessions/$sessionId",
								params: { teamId, sessionId: createdSessionId },
							});
						});
					}}
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
		[actions, activityOpen, navigate, setActivityOpen, t, teamId],
	);

	useEffect(() => {
		setHeaderTitle(activeSessionTitle ?? model.title);
		setHeaderRight(headerActions);
		return () => {
			setHeaderTitle(null);
			setHeaderRight(null);
		};
	}, [activeSessionTitle, headerActions, model.title, setHeaderRight, setHeaderTitle]);

	return <TeamChatView model={model} actions={actions} />;
}
