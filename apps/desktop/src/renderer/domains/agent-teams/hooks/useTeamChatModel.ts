import { useRendererMarkdownModel } from "@shared/hooks/useRendererMarkdownModel";
import { persistBase64Images } from "@shared/lib/persist-input-images";
import { pathBasename } from "@shared/lib/utils";
import { type AgentTeamDocument, resolveMentionedMemberIds, type TeamSessionDocument } from "@vetta/agent-team";
import type { PromptAttachmentRef } from "@vetta/runtime-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	buildTeamTimelineItems,
	reduceTeamStreamState,
	resolveTeamMembers,
	type TeamAttachmentViewModel,
	type TeamChatActions,
	type TeamChatStatus,
	type TeamChatViewModel,
	type TeamPendingRequest,
	type TeamStreamState,
	updateScopedTeamDraft,
} from "../components/team-chat/teamChatModel";
import { agentDisplayName, teamDisplayName } from "../lib/preset-presentation";
import { loadTeamChatSession } from "../services/team-chat-session-service";

export function useTeamChatModel(teamId: string): {
	readonly model: TeamChatViewModel;
	readonly actions: TeamChatActions;
} {
	const { t } = useTranslation(["agent-teams", "chat"]);
	const [document, setDocument] = useState<AgentTeamDocument>();
	const [session, setSession] = useState<TeamSessionDocument>();
	const [draftsByTeam, setDraftsByTeam] = useState<Readonly<Record<string, string>>>({});
	const [historyByTeam, setHistoryByTeam] = useState<Readonly<Record<string, readonly string[]>>>({});
	const [attachmentsByTeam, setAttachmentsByTeam] = useState<
		Readonly<Record<string, readonly TeamAttachmentViewModel[]>>
	>({});
	const [selectedMemberIds, setSelectedMemberIds] = useState<readonly string[]>([]);
	const [pending, setPending] = useState<TeamPendingRequest>();
	const [streams, setStreams] = useState<TeamStreamState>({});
	const [status, setStatus] = useState<TeamChatStatus>("loading");
	const [error, setError] = useState<string>();
	const cancelledRequests = useRef(new Set<string>());
	const pendingRef = useRef<TeamPendingRequest | undefined>(undefined);
	const streamsRef = useRef<TeamStreamState>({});
	pendingRef.current = pending;
	const draft = draftsByTeam[teamId] ?? "";
	const history = historyByTeam[teamId] ?? [];
	const attachments = attachmentsByTeam[teamId] ?? [];
	const updateDraft = useCallback(
		(update: string | ((current: string) => string)) => {
			setDraftsByTeam((current) => updateScopedTeamDraft(current, teamId, update));
		},
		[teamId],
	);
	const setDraft = useCallback((next: string) => updateDraft(next), [updateDraft]);
	const updateAttachments = useCallback(
		(update: (current: readonly TeamAttachmentViewModel[]) => readonly TeamAttachmentViewModel[]) => {
			setAttachmentsByTeam((current) => ({ ...current, [teamId]: update(current[teamId] ?? []) }));
		},
		[teamId],
	);

	const team = useMemo(() => document?.teams.find((candidate) => candidate.id === teamId), [document, teamId]);
	const markdown = useRendererMarkdownModel(session?.cwd ?? null, false);

	useEffect(() => {
		let cancelled = false;
		setStatus("loading");
		setError(undefined);
		setSession(undefined);
		streamsRef.current = {};
		setStreams({});
		setPending(undefined);
		setSelectedMemberIds([]);
		void loadTeamChatSession(teamId)
			.then((loaded) => {
				if (cancelled) return;
				setDocument(loaded.document);
				setSession(loaded.session);
				setStatus("ready");
			})
			.catch((cause: unknown) => {
				if (cancelled) return;
				setError(errorMessage(cause));
				setStatus("error");
			});
		return () => {
			cancelled = true;
		};
	}, [teamId]);

	useEffect(() => {
		if (!session?.id) return;
		let mounted = true;
		let unsubscribe: (() => void) | undefined;
		const subscription = window.vetta.agentTeams.subscribe(session.id, (event) => {
			if (!mounted || event.teamSessionId !== session.id) return;
			if (event.type === "session-snapshot" || event.type === "session-updated") {
				setSession((current) => (!current || event.session.revision >= current.revision ? event.session : current));
			}
			const nextStreams = reduceTeamStreamState(streamsRef.current, event);
			streamsRef.current = nextStreams;
			setStreams(nextStreams);
			if (
				event.type === "member-start" ||
				event.type === "member-delta" ||
				(event.type === "session-snapshot" && event.activeTurns.length > 0)
			) {
				setStatus("streaming");
			} else if (event.type === "session-snapshot") {
				setStatus("ready");
			} else if (event.type === "member-end") {
				if (event.phase === "error") {
					setError(event.error ?? t("chat.failed"));
					setStatus("error");
				} else if (event.phase === "aborted") {
					setStatus("ready");
				} else if (!Object.values(nextStreams).some((turn) => turn.phase === "streaming")) {
					setStatus("ready");
				}
			}
		});
		void subscription
			.then((cancel) => {
				if (mounted) unsubscribe = cancel;
				else cancel();
			})
			.catch((cause: unknown) => {
				if (!mounted) return;
				setError(errorMessage(cause));
				setStatus("error");
			});
		return () => {
			mounted = false;
			unsubscribe?.();
		};
	}, [session?.id, t]);

	const members = useMemo(
		() =>
			resolveTeamMembers(document, team, selectedMemberIds, streams, (profileId, fallbackHandle) => {
				const profile = document?.agents.find((candidate) => candidate.id === profileId);
				return profile ? agentDisplayName(profile, t) : fallbackHandle;
			}),
		[document, selectedMemberIds, streams, t, team],
	);
	const timelineItems = useMemo(
		() =>
			buildTeamTimelineItems({
				session,
				pending,
				streams,
				members,
				labels: {
					delegation: (from, to) => t("chat.delegation", { from, to }),
					unknownMember: t("chat.member"),
				},
			}),
		[members, pending, session, streams, t],
	);

	const selectLeader = useCallback(() => setSelectedMemberIds([]), []);
	const toggleMember = useCallback(
		(memberId: string) => {
			const member = members.find((candidate) => candidate.id === memberId);
			if (!member) return;
			setSelectedMemberIds((current) =>
				current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId],
			);
		},
		[members],
	);
	const selectFiles = useCallback(async () => {
		if (!session) return;
		const paths = await window.vetta.dialog.selectFiles(session.cwd || undefined);
		updateAttachments((current) => mergeAttachments(current, paths.map(toFileAttachment)));
	}, [session, updateAttachments]);
	const selectImages = useCallback(async () => {
		if (!session) return;
		const selected = await window.vetta.dialog.selectImages();
		const paths = await persistBase64Images(selected, session.id, "image-dialog");
		updateAttachments((current) => mergeAttachments(current, paths.map(toImageAttachment)));
	}, [session, updateAttachments]);
	const removeAttachment = useCallback(
		(path: string) => updateAttachments((current) => current.filter((attachment) => attachment.path !== path)),
		[updateAttachments],
	);

	const send = useCallback(async () => {
		const draftText = draft.trim();
		if (!session || !team || (!draftText && attachments.length === 0) || pendingRef.current) return;
		const text = draftText;
		const requestId = crypto.randomUUID();
		const sentAttachments = attachments;
		const targetMemberIds = resolveMentionedMemberIds(team, text, selectedMemberIds);
		const promptAttachments = attachments.map(toPromptAttachment);
		const nextPending = {
			requestId,
			text,
			displayText: draftText,
			attachments: promptAttachments,
			targetMemberIds,
			timestamp: Date.now(),
		};
		pendingRef.current = nextPending;
		setPending(nextPending);
		setStatus("sending");
		setError(undefined);
		const activeStreams = Object.fromEntries(
			Object.entries(streamsRef.current).filter(([, turn]) => turn.phase === "streaming"),
		);
		streamsRef.current = activeStreams;
		setStreams(activeStreams);
		updateDraft("");
		updateAttachments(() => []);
		try {
			const next = await window.vetta.agentTeams.sendMessage(session.id, {
				requestId,
				text,
				targetMemberIds,
				...(promptAttachments.length ? { attachments: promptAttachments } : {}),
			});
			setSession((current) => (!current || next.revision >= current.revision ? next : current));
			setError(undefined);
			setStatus("ready");
			if (draftText) {
				setHistoryByTeam((current) => {
					const previous = current[teamId] ?? [];
					return {
						...current,
						[teamId]: [...previous.filter((item) => item !== draftText), draftText].slice(-50),
					};
				});
			}
		} catch (cause) {
			if (cancelledRequests.current.delete(requestId)) {
				setStatus("ready");
			} else {
				setError(errorMessage(cause));
				setStatus("error");
			}
			updateDraft((current) => current || draftText);
			updateAttachments((current) => mergeAttachments(current, sentAttachments));
		} finally {
			pendingRef.current = undefined;
			setPending(undefined);
		}
	}, [attachments, draft, selectedMemberIds, session, team, teamId, updateAttachments, updateDraft]);

	const abort = useCallback(async () => {
		const request = pendingRef.current;
		if (!session || !request) return;
		cancelledRequests.current.add(request.requestId);
		setStatus("cancelling");
		try {
			await window.vetta.agentTeams.abort(session.id);
		} catch (cause) {
			cancelledRequests.current.delete(request.requestId);
			setError(errorMessage(cause));
			setStatus("error");
		}
	}, [session]);

	const labels = useMemo(
		() => ({
			loading: t("loading"),
			readyTitle: t("chat.readyTitle"),
			readyDescription: t("chat.readyDescription"),
			leaderRoute: t("chat.leaderRoute"),
			placeholder: t("chat.placeholder"),
			hint: t("chat.hint"),
			send: t("chat.send"),
			stop: t("chat.stop"),
			sending: t("chat.sending"),
			failed: t("chat.failed"),
			retry: t("chat.retry"),
			attachFile: t("chat.attachFile"),
			attachImage: t("chat.attachImage"),
			removeAttachment: (name: string) => t("chat.removeAttachment", { name }),
			copy: t("chat:messageList.copyButton.copy"),
			copied: t("chat:messageList.copyButton.copied"),
			navigation: {
				open: t("chat:messageList.navigation.open"),
				title: t("chat:messageList.navigation.title"),
				count: (count: number) => t("chat:messageList.navigation.count", { count }),
				noResults: t("chat:messageList.navigation.noResults"),
				close: t("chat:messageList.navigation.close"),
				searchPlaceholder: t("chat:messageList.navigation.searchPlaceholder"),
				searchLabel: t("chat:messageList.navigation.searchLabel"),
				jumpTo: (preview: string) => t("chat:messageList.navigation.jumpTo", { preview }),
				emptyRequest: t("chat:messageList.navigation.emptyUser"),
			},
		}),
		[t],
	);
	const model = useMemo<TeamChatViewModel>(
		() => ({
			feedKey: teamId,
			title: team ? teamDisplayName(team, t) : t("teams.title"),
			status,
			draft,
			history,
			attachments,
			members,
			timelineItems,
			markdown,
			...(error ? { error } : {}),
			editorEnabled: Boolean(session),
			canSend: Boolean(session && (draft.trim() || attachments.length > 0) && !pending),
			labels,
		}),
		[
			teamId,
			team,
			t,
			status,
			draft,
			history,
			attachments,
			members,
			timelineItems,
			markdown,
			error,
			session,
			pending,
			labels,
		],
	);
	const actions = useMemo<TeamChatActions>(
		() => ({ setDraft, selectLeader, toggleMember, selectFiles, selectImages, removeAttachment, send, abort }),
		[setDraft, selectLeader, toggleMember, selectFiles, selectImages, removeAttachment, send, abort],
	);

	return { model, actions };
}

function mergeAttachments(
	current: readonly TeamAttachmentViewModel[],
	additions: readonly TeamAttachmentViewModel[],
): readonly TeamAttachmentViewModel[] {
	const byPath = new Map(current.map((attachment) => [attachment.path, attachment]));
	for (const attachment of additions) byPath.set(attachment.path, attachment);
	return [...byPath.values()];
}

function toFileAttachment(path: string): TeamAttachmentViewModel {
	return { path, name: pathBasename(path), kind: "file" };
}

function toImageAttachment(path: string): TeamAttachmentViewModel {
	return { path, name: pathBasename(path), kind: "image" };
}

function toPromptAttachment(attachment: TeamAttachmentViewModel): PromptAttachmentRef {
	return { kind: attachment.kind, path: attachment.path };
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
