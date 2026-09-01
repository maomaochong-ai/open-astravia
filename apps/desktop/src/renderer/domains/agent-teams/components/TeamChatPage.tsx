import { pageHeaderRightSlotAtom, pageHeaderTitleAtom } from "@shared/store/atoms";
import {
	resolveMentionedMemberIds,
	type AgentTeamDocument,
	type TeamSessionDocument,
} from "@vetta/agent-team";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button } from "@vetta/ui";
import { useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentTeamSidebarSelection } from "../hooks/useAgentTeamSidebarSelection";
import { teamDisplayName } from "../lib/preset-presentation";
import { TeamChatView } from "./team-chat/TeamChatView";

const SESSION_STORAGE_PREFIX = "vetta.agent-team.session.";

export function TeamChatPage(): JSX.Element {
	const { t } = useTranslation("agent-teams");
	useAgentTeamSidebarSelection();
	const navigate = useNavigate();
	const { teamId } = useParams({ from: "/agent-teams/$teamId" });
	const setHeaderTitle = useSetAtom(pageHeaderTitleAtom);
	const setHeaderRight = useSetAtom(pageHeaderRightSlotAtom);
	const [document, setDocument] = useState<AgentTeamDocument>();
	const [session, setSession] = useState<TeamSessionDocument>();
	const [text, setText] = useState("");
	const [pendingText, setPendingText] = useState<string>();
	const [targetMemberIds, setTargetMemberIds] = useState<readonly string[]>([]);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string>();

	const team = useMemo(
		() => document?.teams.find((candidate) => candidate.id === teamId),
		[document, teamId],
	);

	useEffect(() => {
		let cancelled = false;
		void loadSession(teamId)
			.then(({ document: nextDocument, session: nextSession }) => {
				if (cancelled) return;
				setDocument(nextDocument);
				setSession(nextSession);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(errorMessage(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [teamId]);

	useEffect(() => {
		setHeaderTitle(team ? teamDisplayName(team, t) : t("teams.title"));
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
	}, [navigate, setHeaderRight, setHeaderTitle, t, team?.name, teamId]);

	async function send(): Promise<void> {
		const message = text.trim();
		if (!session || !message || sending) return;
		const routedMemberIds = team
			? resolveMentionedMemberIds(team, message, targetMemberIds)
			: targetMemberIds;
		setSending(true);
		setError(undefined);
		setText("");
		setPendingText(message);
		try {
			const next = await window.vetta.agentTeams.sendMessage(session.id, {
				requestId: crypto.randomUUID(),
				text: message,
				targetMemberIds: routedMemberIds,
			});
			setSession(next);
		} catch (cause) {
			setError(errorMessage(cause));
			setText(message);
		} finally {
			setPendingText(undefined);
			setSending(false);
		}
	}

	return (
		<TeamChatView
			document={document}
			team={team}
			session={session}
			text={text}
			pendingText={pendingText}
			targetMemberIds={targetMemberIds}
			sending={sending}
			error={error}
			onTextChange={setText}
			onTargetMemberIdsChange={setTargetMemberIds}
			onSend={() => void send()}
		/>
	);
}

async function loadSession(
	teamId: string,
): Promise<{ document: AgentTeamDocument; session: TeamSessionDocument }> {
	const document = await window.vetta.agentTeams.list();
	if (!document.teams.some((team) => team.id === teamId)) {
		throw new Error(`Agent team not found: ${teamId}`);
	}

	const key = `${SESSION_STORAGE_PREFIX}${teamId}`;
	const storedId = window.localStorage.getItem(key);
	if (storedId) {
		try {
			return { document, session: await window.vetta.agentTeams.getSession(storedId) };
		} catch {
			window.localStorage.removeItem(key);
		}
	}

	const config = await window.vetta.config.get();
	const cwd = config.defaultConversationCwd ?? config.workspacePath;
	const session = await window.vetta.agentTeams.createSession(teamId, cwd);
	window.localStorage.setItem(key, session.id);
	return { document, session };
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
