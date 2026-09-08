import {
	activityPanelOpenAtom,
	pageHeaderRightSlotAtom,
	pageHeaderTitleAtom,
} from "@shared/store/atoms";
import { ChatHeaderActions } from "@vetta/theme-ui/chat";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useAtom, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useTeamChatModel } from "./useTeamChatModel";
import { TeamChatView } from "./TeamChatView";

export function TeamChatPage({ createNewSession = false }: { readonly createNewSession?: boolean }): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const navigate = useNavigate();
	const { teamId, sessionId, memberId } = useParams({ strict: false });
	if (!teamId) throw new Error("Team route is missing teamId");
	const setHeaderTitle = useSetAtom(pageHeaderTitleAtom);
	const setHeaderRight = useSetAtom(pageHeaderRightSlotAtom);
	const { model, actions } = useTeamChatModel(teamId, sessionId, memberId, createNewSession);
	const openMember = useCallback(
		(targetMemberId: string) => {
			if (!sessionId) return;
			void navigate({
				to: "/agent-teams/$teamId/sessions/$sessionId/members/$memberId",
				params: { teamId, sessionId, memberId: targetMemberId },
			});
		},
		[navigate, sessionId, teamId],
	);
	const [activityOpen, setActivityOpen] = useAtom(activityPanelOpenAtom);
	const activeSessionTitle = model.sessions.find((session) => session.id === model.activeSessionId)?.label;
	const backToTeam = useCallback(() => {
		if (!sessionId) return;
		void navigate({
			to: "/agent-teams/$teamId/sessions/$sessionId",
			params: { teamId, sessionId },
		});
	}, [navigate, sessionId, teamId]);
	const openTeamSettings = useCallback(() => {
		void navigate({ to: "/agent-teams/$teamId/settings", params: { teamId } });
	}, [navigate, teamId]);

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
			<ChatHeaderActions.Panel
				title={t("chat.activity")}
				open={activityOpen}
				onClick={() => setActivityOpen((open) => !open)}
			/>
		),
		[activityOpen, setActivityOpen, t],
	);

	useEffect(() => {
		setHeaderTitle(activeSessionTitle ?? model.title);
		setHeaderRight(headerActions);
		return () => {
			setHeaderTitle(null);
			setHeaderRight(null);
		};
	}, [activeSessionTitle, headerActions, model.title, setHeaderRight, setHeaderTitle]);

	return (
		<TeamChatView
			model={model}
			actions={actions}
			onOpenMember={openMember}
			onBackToTeam={backToTeam}
			onOpenSettings={openTeamSettings}
		/>
	);
}

export function TeamNewSessionPage(): JSX.Element {
	return <TeamChatPage createNewSession />;
}
