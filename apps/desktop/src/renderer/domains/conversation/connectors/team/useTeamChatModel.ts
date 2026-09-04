import type { DesktopTeamSessionSnapshot } from "@preload/api-types/team-conversation-display";
import { agentDisplayName, teamDisplayName } from "@shared/agent-teams/preset-presentation";
import { notifyTeamSessionsChanged } from "@shared/agent-teams/team-session-events";
import { deriveAttachments, parseInputSegments, pathTokenText, segmentsToText } from "@shared/lib/input-tokens";
import { persistBase64Images } from "@shared/lib/persist-input-images";
import { pathBasename } from "@shared/lib/utils";
import { reasoningByModelAtom, selectedModelAtom } from "@shared/store/atoms";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";
import type { TeamSessionListItem } from "@vetta/agent-team";
import { type AgentTeamDocument, resolveMentionedMemberIds } from "@vetta/agent-team";
import type { PromptAttachmentRef, SessionExecutionMode } from "@vetta/runtime-core";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createTeamChatSession, loadTeamChatSession } from "./team-chat-session-service";
import {
	projectTeamConversationTimeline,
	reduceTeamStreamState,
	resolveTeamMembers,
	type TeamAttachmentViewModel,
	type TeamChatActions,
	type TeamChatStatus,
	type TeamChatViewModel,
	type TeamPendingRequest,
	type TeamStreamState,
	updateScopedTeamDraft,
} from "./teamChatModel";

export function useTeamChatModel(
	teamId: string,
	preferredSessionId?: string,
): {
	readonly model: TeamChatViewModel;
	readonly actions: TeamChatActions;
} {
	const { t } = useTranslation(["agent-teams", "chat"]);
	const selectedModel = useAtomValue(selectedModelAtom);
	const reasoningByModel = useAtomValue(reasoningByModelAtom);
	const [document, setDocument] = useState<AgentTeamDocument>();
	const [snapshot, setSnapshot] = useState<DesktopTeamSessionSnapshot>();
	const [sessions, setSessions] = useState<readonly TeamSessionListItem[]>([]);
	const session = snapshot?.session;
	const effectiveModelKey = session?.modelSettings?.modelKey ?? selectedModel;
	const effectiveReasoning =
		session?.modelSettings?.reasoning ?? (effectiveModelKey ? reasoningByModel[effectiveModelKey] : undefined);
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
	const [contextUsages, setContextUsages] = useState<
		Readonly<Record<string, NonNullable<TeamChatViewModel["contextUsage"]>>>
	>({});
	const [compactingByRuntime, setCompactingByRuntime] = useState<Readonly<Record<string, boolean>>>({});
	const loadedSessionRef = useRef<{ readonly teamId: string; readonly sessionId: string } | undefined>(undefined);
	const cancelledRequests = useRef(new Set<string>());
	const pendingRef = useRef<TeamPendingRequest | undefined>(undefined);
	const streamsRef = useRef<TeamStreamState>({});
	pendingRef.current = pending;
	const draftScope = session?.id ?? teamId;
	const draft = draftsByTeam[draftScope] ?? "";
	const history = historyByTeam[draftScope] ?? [];
	const attachments = attachmentsByTeam[draftScope] ?? [];
	const updateDraft = useCallback(
		(update: string | ((current: string) => string)) => {
			setDraftsByTeam((current) => updateScopedTeamDraft(current, draftScope, update));
		},
		[draftScope],
	);
	const updateAttachments = useCallback(
		(update: (current: readonly TeamAttachmentViewModel[]) => readonly TeamAttachmentViewModel[]) => {
			setAttachmentsByTeam((current) => ({
				...current,
				[draftScope]: update(current[draftScope] ?? []),
			}));
		},
		[draftScope],
	);
	const setDraft = useCallback(
		(next: string) => {
			updateDraft(next);
			const derived = deriveAttachments(parseInputSegments(next).segments).map((attachment) => ({
				path: attachment.path,
				name: pathBasename(attachment.path),
				kind: attachment.kind === "image" ? ("image" as const) : ("file" as const),
			}));
			updateAttachments(() => derived);
		},
		[updateAttachments, updateDraft],
	);

	const team = useMemo(() => document?.teams.find((candidate) => candidate.id === teamId), [document, teamId]);
	const applyLoadedSession = useCallback(
		(loaded: Awaited<ReturnType<typeof loadTeamChatSession>>) => {
			loadedSessionRef.current = { teamId, sessionId: loaded.snapshot.session.id };
			setDocument(loaded.document);
			setSnapshot(loaded.snapshot);
			setSessions(loaded.sessions);
			setStatus("ready");
		},
		[teamId],
	);

	useEffect(() => {
		let cancelled = false;
		const loaded = loadedSessionRef.current;
		if (loaded?.teamId === teamId && (!preferredSessionId || loaded.sessionId === preferredSessionId)) return;
		setStatus("loading");
		setError(undefined);
		setSnapshot(undefined);
		streamsRef.current = {};
		setStreams({});
		setPending(undefined);
		setSelectedMemberIds([]);
		setContextUsages({});
		setCompactingByRuntime({});
		void loadTeamChatSession(teamId, preferredSessionId)
			.then((loaded) => {
				if (cancelled) return;
				applyLoadedSession(loaded);
			})
			.catch((cause: unknown) => {
				if (cancelled) return;
				setError(errorMessage(cause));
				setStatus("error");
			});
		return () => {
			cancelled = true;
		};
	}, [teamId, preferredSessionId, applyLoadedSession]);

	const openSession = useCallback(
		async (sessionId: string) => {
			if (sessionId === session?.id || pendingRef.current) return;
			setStatus("loading");
			setError(undefined);
			try {
				applyLoadedSession(await loadTeamChatSession(teamId, sessionId));
			} catch (cause) {
				setError(errorMessage(cause));
				setStatus("error");
			}
		},
		[applyLoadedSession, session?.id, teamId],
	);
	const createSession = useCallback(async () => {
		if (pendingRef.current) return undefined;
		setStatus("loading");
		setError(undefined);
		try {
			const loaded = await createTeamChatSession(teamId, document, sessions);
			applyLoadedSession(loaded);
			notifyTeamSessionsChanged();
			return loaded.snapshot.session.id;
		} catch (cause) {
			setError(errorMessage(cause));
			setStatus("error");
			return undefined;
		}
	}, [applyLoadedSession, document, sessions, teamId]);
	const updateModelSettings = useCallback(
		async (modelKey: string, reasoning?: string) => {
			if (!session) return;
			setError(undefined);
			try {
				const next = await window.vetta.agentTeams.updateModelSettings(session.id, {
					modelKey,
					...(reasoning ? { reasoning } : {}),
				});
				setSnapshot(next);
			} catch (cause) {
				setError(errorMessage(cause));
			}
		},
		[session],
	);
	const selectModel = useCallback(
		(modelKey: string, defaultReasoning?: string) =>
			updateModelSettings(modelKey, reasoningByModel[modelKey] ?? defaultReasoning),
		[reasoningByModel, updateModelSettings],
	);
	const selectReasoning = useCallback(
		(reasoning: string) =>
			effectiveModelKey ? updateModelSettings(effectiveModelKey, reasoning) : Promise.resolve(),
		[effectiveModelKey, updateModelSettings],
	);
	useEffect(() => {
		if (!session || session.modelSettings || !selectedModel) return;
		void updateModelSettings(selectedModel, reasoningByModel[selectedModel]);
	}, [reasoningByModel, selectedModel, session, updateModelSettings]);

	useEffect(() => {
		if (!session?.id) return;
		let mounted = true;
		let unsubscribe: (() => void) | undefined;
		const subscription = window.vetta.agentTeams.subscribe(session.id, (event) => {
			const eventSessionId =
				event.type === "session-snapshot" || event.type === "session-updated"
					? event.teamSessionId
					: event.conversationId;
			if (!mounted || eventSessionId !== session.id) return;
			if (event.type === "session-snapshot" || event.type === "session-updated") {
				if (event.snapshot.display?.contextUsage?.runtimeSessionId) {
					const { memberId: _memberId, runtimeSessionId, ...usage } = event.snapshot.display.contextUsage;
					setContextUsages((current) => ({
						...current,
						[runtimeSessionId]: usage,
					}));
				}
				setSnapshot((current) =>
					!current ||
					event.snapshot.session.revision > current.session.revision ||
					event.snapshot.conversationRevision >= current.conversationRevision
						? event.snapshot
						: current,
				);
			}
			if (event.type === "desktop.team-context-usage") {
				setContextUsages((current) => ({ ...current, [event.runtimeSessionId]: event.contextUsage }));
				if (event.isCompacting !== undefined) {
					setCompactingByRuntime((current) => ({
						...current,
						[event.runtimeSessionId]: event.isCompacting ?? false,
					}));
				}
			}
			const nextStreams = reduceTeamStreamState(streamsRef.current, event);
			streamsRef.current = nextStreams;
			setStreams(nextStreams);
			if (
				event.type === "conversation.agent-message-event" ||
				(event.type === "session-snapshot" && event.activeMessageEvents.length > 0)
			) {
				setStatus("streaming");
			} else if (event.type === "session-snapshot") {
				setStatus("ready");
			} else if (event.type === "conversation.agent-message-discard") {
				if (event.reason === "failed") {
					setError(event.error ?? t("chat.failed"));
					setStatus("error");
				} else if (event.reason === "aborted") {
					setStatus("ready");
				} else if (!Object.values(nextStreams).some((turn) => turn.message.phase === "streaming")) {
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

	const setExecutionMode = useCallback(
		async (mode: SessionExecutionMode) => {
			if (!session) return;
			try {
				const next = await window.vetta.agentTeams.setExecutionMode(session.id, mode);
				setSnapshot(next);
			} catch (cause) {
				setError(errorMessage(cause));
				throw cause;
			}
		},
		[session],
	);
	const memberRuntimeIds = useMemo(
		() =>
			session
				? Object.fromEntries(
						Object.entries(session.memberRuntime).map(([memberId, runtime]) => [memberId, runtime.sessionId]),
					)
				: {},
		[session],
	);
	const activeContextRuntimeId = useMemo(() => {
		const selected = selectedMemberIds[0];
		return memberRuntimeIds[selected] ?? memberRuntimeIds[session?.leaderMemberId ?? ""];
	}, [memberRuntimeIds, selectedMemberIds, session?.leaderMemberId]);
	const contextUsage = (activeContextRuntimeId ? contextUsages[activeContextRuntimeId] : undefined) ?? null;
	const isCompacting = activeContextRuntimeId ? compactingByRuntime[activeContextRuntimeId] === true : false;

	const members = useMemo(
		() =>
			resolveTeamMembers(document, team, selectedMemberIds, streams, (profileId, fallbackHandle) => {
				const profile = document?.agents.find((candidate) => candidate.id === profileId);
				return profile ? agentDisplayName(profile, t) : fallbackHandle;
			}),
		[document, selectedMemberIds, streams, t, team],
	);
	const feedItems = useMemo(
		() =>
			projectTeamConversationTimeline({
				snapshot,
				pending,
				streams,
				members,
				labels: {
					delegation: (from, to) => t("chat.delegation", { from, to }),
					unknownMember: t("chat.member"),
				},
			}),
		[members, pending, snapshot, streams, t],
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
	const addAttachments = useCallback(
		(additions: readonly TeamAttachmentViewModel[]) => {
			const existingPaths = new Set(deriveAttachments(parseInputSegments(draft).segments).map((item) => item.path));
			const newTokens = additions
				.filter((attachment) => !existingPaths.has(attachment.path))
				.map((attachment) => pathTokenText(attachment.path));
			updateAttachments((current) => mergeAttachments(current, additions));
			if (newTokens.length > 0)
				updateDraft((current) => [current.trimEnd(), ...newTokens].filter(Boolean).join(" "));
		},
		[draft, updateAttachments, updateDraft],
	);
	const selectFiles = useCallback(async () => {
		if (!session) return;
		const paths = await window.vetta.dialog.selectFiles(session.cwd || undefined);
		addAttachments(paths.map(toFileAttachment));
	}, [addAttachments, session]);
	const selectImages = useCallback(async () => {
		if (!session) return;
		const selected = await window.vetta.dialog.selectImages();
		const paths = await persistBase64Images(selected, session.id, "image-dialog");
		addAttachments(paths.map(toImageAttachment));
	}, [addAttachments, session]);
	const removeAttachment = useCallback(
		(path: string) => {
			updateAttachments((current) => current.filter((attachment) => attachment.path !== path));
			updateDraft((current) =>
				segmentsToText(
					parseInputSegments(current).segments.filter(
						(segment) => !((segment.kind === "file" || segment.kind === "image") && segment.path === path),
					),
				),
			);
		},
		[updateAttachments, updateDraft],
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
			Object.entries(streamsRef.current).filter(([, turn]) => turn.message.phase === "streaming"),
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
				...(effectiveModelKey ? { modelKey: effectiveModelKey } : {}),
				...(effectiveReasoning ? { reasoning: effectiveReasoning } : {}),
			});
			setSnapshot((current) =>
				!current ||
				next.session.revision > current.session.revision ||
				next.conversationRevision >= current.conversationRevision
					? next
					: current,
			);
			setError(undefined);
			setStatus("ready");
			if (draftText) {
				setHistoryByTeam((current) => {
					const previous = current[draftScope] ?? [];
					return {
						...current,
						[draftScope]: [...previous.filter((item) => item !== draftText), draftText].slice(-50),
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
	}, [
		attachments,
		draft,
		selectedMemberIds,
		session,
		team,
		draftScope,
		updateAttachments,
		updateDraft,
		effectiveModelKey,
		effectiveReasoning,
	]);

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
			leaderRoute: t("chat.leaderRoute"),
			placeholder: t("chat.placeholder"),
			attachFile: t("chat.attachFile"),
			attachImage: t("chat.attachImage"),
		}),
		[t],
	);
	const model = useMemo<TeamChatViewModel>(
		() => ({
			feedKey: session?.id ?? teamId,
			title: team ? teamDisplayName(team, t) : t("teams.title"),
			status,
			draft,
			history,
			attachments,
			members,
			feedItems,
			...(error ? { error } : {}),
			editorEnabled: Boolean(session),
			canSend: Boolean(session && (draft.trim() || attachments.length > 0) && !pending),
			workspace: session
				? createActivityWorkspace(session.workspaceId ?? `agent-team:${teamId}`, session.cwd)
				: null,
			activeSessionId: session?.id ?? null,
			runtimeSessionIds: session ? Object.values(session.memberRuntime).map((runtime) => runtime.sessionId) : [],
			memberRuntimeIds,
			executionMode: session?.executionMode ?? snapshot?.display?.executionMode ?? "full-access",
			contextUsage,
			isCompacting,
			modelKey: effectiveModelKey,
			...(effectiveReasoning ? { reasoning: effectiveReasoning } : {}),
			sessions: sessions.map((item, index) => ({
				id: item.id,
				label: t("chat.sessionLabel", { index: sessions.length - index }),
			})),
			sessionActionsDisabled: status === "loading" || Boolean(pending),
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
			feedItems,
			error,
			session,
			pending,
			sessions,
			effectiveModelKey,
			effectiveReasoning,
			labels,
			contextUsage,
			isCompacting,
			memberRuntimeIds,
			snapshot?.display?.executionMode,
		],
	);
	const actions = useMemo<TeamChatActions>(
		() => ({
			setDraft,
			selectLeader,
			toggleMember,
			selectFiles,
			selectImages,
			removeAttachment,
			addAttachments,
			send,
			abort,
			createSession,
			openSession,
			selectModel,
			selectReasoning,
			setExecutionMode,
		}),
		[
			setDraft,
			selectLeader,
			toggleMember,
			selectFiles,
			selectImages,
			removeAttachment,
			addAttachments,
			send,
			abort,
			createSession,
			openSession,
			selectModel,
			selectReasoning,
			setExecutionMode,
		],
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
