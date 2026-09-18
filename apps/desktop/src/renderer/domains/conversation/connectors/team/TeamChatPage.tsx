import { useOwnedHeaderSlot } from "@shared/hooks/useOwnedHeaderSlot";
import {
	activityPanelOpenAtom,
	pageHeaderRightSlotAtom,
	pageHeaderTitleAtom,
} from "@shared/store/atoms";
import { useSurfaceActive } from "@shared/surface-active";
import { ChatHeaderActions } from "@vetta-org/theme-ui/chat";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useAtom, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useTeamChatModel } from "./useTeamChatModel";
import { TeamChatView } from "./TeamChatView";

export interface TeamChatPageProps {
	readonly createNewSession?: boolean;
	/** 保活宿主传入：切走后 URL 不再带团队参数，不能再读 useParams。 */
	readonly teamId?: string;
	readonly sessionId?: string;
	readonly memberId?: string;
}

export function TeamChatPage({
	createNewSession = false,
	teamId: teamIdProp,
	sessionId: sessionIdProp,
	memberId: memberIdProp,
}: TeamChatPageProps): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const navigate = useNavigate();
	const params = useParams({ strict: false });
	const teamId = teamIdProp ?? params.teamId;
	const sessionId = teamIdProp !== undefined ? sessionIdProp : params.sessionId;
	const memberId = teamIdProp !== undefined ? memberIdProp : params.memberId;
	if (!teamId) throw new Error("Team route is missing teamId");
	const surfaceActive = useSurfaceActive();
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
		if (!surfaceActive) return;
		if (sessionId || !model.activeSessionId) return;
		void navigate({
			to: "/agent-teams/$teamId/sessions/$sessionId",
			params: { teamId, sessionId: model.activeSessionId },
			replace: true,
		});
	}, [model.activeSessionId, navigate, sessionId, surfaceActive, teamId]);

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

	useOwnedHeaderSlot(surfaceActive, activeSessionTitle ?? model.title, setHeaderTitle);
	useOwnedHeaderSlot(surfaceActive, headerActions, setHeaderRight);

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
