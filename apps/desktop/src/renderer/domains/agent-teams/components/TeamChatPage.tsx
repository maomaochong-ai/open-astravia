import { inputValueAtom, pageHeaderRightSlotAtom, pageHeaderTitleAtom } from "@shared/store/atoms";
import {
	resolveMentionedMemberIds,
	type AgentTeamDocument,
	type TeamSessionDocument,
} from "@vetta/agent-team";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button } from "@vetta/ui";
import { useAtom, useSetAtom } from "jotai";
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
	const [text, setText] = useAtom(inputValueAtom);
	const [pendingText, setPendingText] = useState<string>();
	const [targetMemberIds, setTargetMemberIds] = useState<readonly string[]>([]);
	const [streamingByMember, setStreamingByMember] = useState<Record<string, string>>({});
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
		if (!session) return;
		let mounted = true;
		let unsubscribe: (() => void) | undefined;
	const subscription = window.vetta.agentTeams.subscribe(session.id, (event) => {
			if (!mounted || event.teamSessionId !== session.id) return;
			if (event.type === "member-start") {
				setStreamingByMember((current) => ({ ...current, [event.memberId]: "" }));
				return;
			}
			if (event.type === "member-delta") {
				setStreamingByMember((current) => ({
					...current,
					[event.memberId]: `${current[event.memberId] ?? ""}${event.delta}`,
				}));
				return;
			}
			setSession(event.session);
			setStreamingByMember({});
		});
		void subscription.then((cancel) => {
			if (mounted) unsubscribe = cancel;
			else cancel();
		});
		return () => {
			mounted = false;
			unsubscribe?.();
		};
	}, [session?.id]);

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

	async function send(overrideText?: string): Promise<void> {
		const message = (overrideText ?? text).trim();
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
			setStreamingByMember({});
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
			streamingByMember={streamingByMember}
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
