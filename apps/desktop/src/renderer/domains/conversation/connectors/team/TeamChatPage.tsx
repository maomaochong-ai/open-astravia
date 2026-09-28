import {
	activityPanelOpenAtom,
	pageHeaderRightSlotAtom,
	pageHeaderTitleAtom,
} from "@shared/store/atoms";
import { ChatHeaderActions } from "@vetta-org/theme-ui/chat";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useAtom, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOpenTerminal } from "@domains/bottom-panel/hooks/useOpenTerminal";
import { useBottomPanelToggle } from "@domains/bottom-panel/hooks/useBottomPanelToggle";
import { BackgroundTasksBadge } from "../../components/BackgroundTasksBadge";
import { SandboxGrantsBadge } from "../../components/SandboxGrantsBadge";
import { useWindowPinAction } from "../../hooks/useWindowPinAction";
import type { WorkSurfaceScope } from "@shared/workspace/work-surface";
import { useTeamChatModel } from "./useTeamChatModel";
import { TeamChatView } from "./TeamChatView";
import { isTeamChatStreaming } from "./teamChatModel";

export function TeamChatPage({ createNewSession = false }: { readonly createNewSession?: boolean }): JSX.Element {
	const { t } = useTranslation(["agent-teams", "chat"]);
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
	const [exporting, setExporting] = useState(false);
	const workSurface = useMemo<WorkSurfaceScope | null>(
		() =>
			model.activeSessionId
				? {
						key: `agent-team:${model.activeSessionId}`,
						cwd: model.workspace?.cwd ?? null,
						scenario: model.pluginScenario,
					}
				: null,
		[model.activeSessionId, model.pluginScenario, model.workspace?.cwd],
	);
	const pin = useWindowPinAction();
	const terminal = useOpenTerminal(workSurface);
	const bottomPanel = useBottomPanelToggle(workSurface);
	const runtimeIds = model.workspace?.runtimeIds ?? [];
	const activityWorkspaceId = model.workspace?.id ?? `agent-team:${teamId}`;
	const isStreaming = isTeamChatStreaming(model);
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
			<>
				<BackgroundTasksBadge runtimeIds={runtimeIds} activityWorkspaceId={activityWorkspaceId} />
				<SandboxGrantsBadge runtimeIds={runtimeIds} />
				<ChatHeaderActions.Export
					title={t("chat:chatView.exportButton.title")}
					disabled={model.feedItems.length === 0 || isStreaming || exporting}
					exporting={exporting}
					onClick={() => setExporting(true)}
				/>
				<ChatHeaderActions.Pin
					title={
						pin.pinned
							? t("chat:chatView.pinButton.pinned")
							: t("chat:chatView.pinButton.unpinned")
					}
					pinned={pin.pinned}
					onClick={pin.toggle}
				/>
				<ChatHeaderActions.Terminal
					title={
						!terminal.available
							? t("chat:chatView.terminalButton.unavailable")
							: terminal.focused
								? t("chat:chatView.terminalButton.focused")
								: t("chat:chatView.terminalButton.open")
					}
					focused={terminal.focused}
					disabled={!terminal.available}
					onClick={terminal.open}
				/>
				<ChatHeaderActions.BottomPanel
					title={
						bottomPanel.open
							? t("chat:chatView.bottomPanelButton.open")
							: t("chat:chatView.bottomPanelButton.closed")
					}
					open={bottomPanel.open}
					onClick={bottomPanel.toggle}
				/>
				<ChatHeaderActions.Panel
					title={t("chat.activity")}
					open={activityOpen}
					onClick={() => setActivityOpen((open) => !open)}
				/>
			</>
		),
		[
			activityOpen,
			activityWorkspaceId,
			bottomPanel,
			exporting,
			isStreaming,
			model.feedItems.length,
			pin,
			runtimeIds,
			setActivityOpen,
			t,
			terminal,
		],
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
			workSurface={workSurface}
			exportState={
				exporting
					? {
							title: activeSessionTitle ?? model.title,
							onFinished: () => setExporting(false),
						}
					: undefined
			}
		/>
	);
}

export function TeamNewSessionPage(): JSX.Element {
	return <TeamChatPage createNewSession />;
}
