import { pageHeaderRightSlotAtom, pageHeaderTitleAtom } from "@shared/store/atoms";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button } from "@vetta/ui";
import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAgentTeamSidebarSelection } from "../hooks/useAgentTeamSidebarSelection";
import { useTeamChatModel } from "../hooks/useTeamChatModel";
import { TeamChatView } from "./team-chat/TeamChatView";

export function TeamChatPage(): JSX.Element {
	const { t } = useTranslation("agent-teams");
	useAgentTeamSidebarSelection();
	const navigate = useNavigate();
	const { teamId } = useParams({ from: "/agent-teams/$teamId" });
	const setHeaderTitle = useSetAtom(pageHeaderTitleAtom);
	const setHeaderRight = useSetAtom(pageHeaderRightSlotAtom);
	const { model, actions } = useTeamChatModel(teamId);

	useEffect(() => {
		setHeaderTitle(model.title);
		setHeaderRight(
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
			</Button>,
		);
		return () => {
			setHeaderTitle(null);
			setHeaderRight(null);
		};
	}, [model.title, navigate, setHeaderRight, setHeaderTitle, t, teamId]);

	return <TeamChatView model={model} actions={actions} />;
}
