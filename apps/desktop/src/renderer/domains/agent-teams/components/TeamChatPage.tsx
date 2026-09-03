import { activityPanelOpenAtom, pageHeaderRightSlotAtom, pageHeaderTitleAtom } from "@shared/store/atoms";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vetta/ui";
import { useAtom, useSetAtom } from "jotai";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAgentTeamSidebarSelection } from "../hooks/useAgentTeamSidebarSelection";
import { useTeamChatModel } from "../hooks/useTeamChatModel";
import { TeamChatView } from "./team-chat/TeamChatView";

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

	useEffect(() => {
		if (sessionId || !model.activeSessionId) return;
		void navigate({
			to: "/agent-teams/$teamId/sessions/$sessionId",
			params: { teamId, sessionId: model.activeSessionId },
			replace: true,
		});
	}, [model.activeSessionId, navigate, sessionId, teamId]);

	useEffect(() => {
		setHeaderTitle(model.title);
		setHeaderRight(
			<div className="flex items-center gap-1.5">
				{model.activeSessionId ? (
					<Select
						value={model.activeSessionId}
						disabled={model.sessionActionsDisabled}
						onValueChange={(value) =>
							void navigate({
								to: "/agent-teams/$teamId/sessions/$sessionId",
								params: { teamId, sessionId: value },
							})
						}
					>
						<SelectTrigger className="h-8 w-32" aria-label={t("chat.selectSession")}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{model.sessions.map((session) => (
								<SelectItem key={session.id} value={session.id}>
									{session.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : null}
				<Button
					variant={activityOpen ? "secondary" : "ghost"}
					size="sm"
					aria-pressed={activityOpen}
					onClick={() => setActivityOpen((open) => !open)}
				>
					<span className="icon-[solar--sidebar-minimalistic-linear] h-4 w-4" aria-hidden="true" />
					{t("chat.activity")}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					disabled={model.sessionActionsDisabled}
					onClick={() =>
						void actions.createSession().then((createdSessionId) => {
							if (!createdSessionId) return;
							void navigate({
								to: "/agent-teams/$teamId/sessions/$sessionId",
								params: { teamId, sessionId: createdSessionId },
							});
						})
					}
				>
					<span className="icon-[solar--add-circle-linear] h-4 w-4" aria-hidden="true" />
					{t("chat.newSession")}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onClick={() =>
						void navigate({
							to: "/agent-teams/$teamId/settings",
							params: { teamId },
						})
					}
				>
					<span className="icon-[solar--settings-linear] h-4 w-4" aria-hidden="true" />
					{t("chat.configure")}
				</Button>
			</div>,
		);
		return () => {
			setHeaderTitle(null);
			setHeaderRight(null);
		};
	}, [actions, activityOpen, model, navigate, setActivityOpen, setHeaderRight, setHeaderTitle, t, teamId]);

	return <TeamChatView model={model} actions={actions} />;
}
