import type { DesktopTeamSessionSnapshot } from "@preload/api-types/team-conversation-display";
import { agentDisplayName, teamDisplayName } from "@shared/agent-teams/agent-team-presentation";
import { notifyTeamSessionsChanged } from "@shared/agent-teams/team-session-events";
import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { deriveAttachments, parseInputSegments, pathTokenText, segmentsToText } from "@shared/lib/input-tokens";
import { persistBase64Images } from "@shared/lib/persist-input-images";
import { pathBasename } from "@shared/lib/utils";
import { reasoningByModelAtom, selectedModelAtom } from "@shared/store/atoms";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";
import type { TeamSessionListItem } from "@vetta/agent-team";
import { type AgentTeamDocument, resolveMentionedMemberIds } from "@vetta/agent-team";
import type { PromptAttachmentRef, SessionExecutionMode } from "@vetta/runtime-core";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslation } from "react-i18next";
import { resolveSessionContextComposition } from "../../services/context-composition-cache";
import { createTeamChatSession, loadTeamChatBootstrap, loadTeamChatSession } from "./team-chat-session-service";
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
	memberViewId?: string,
	createNewSession = false,
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
	const [failedMemberIds, setFailedMemberIds] = useState<ReadonlySet<string>>(() => new Set());
	const [pending, setPending] = useState<TeamPendingRequest>();
	const [streams, setStreams] = useState<TeamStreamState>({});
	const [status, setStatus] = useState<TeamChatStatus>("loading");
	const [, startTeamTransition] = useTransition();
	const [error, setError] = useState<string>();
	const [contextUsages, setContextUsages] = useState<
		Readonly<Record<string, NonNullable<TeamChatViewModel["contextUsage"]>>>
	>({});
	const [compactingByRuntime, setCompactingByRuntime] = useState<Readonly<Record<string, boolean>>>({});
	const sessionRef = useRef(session);
	sessionRef.current = session;
	const loadedSessionRef = useRef<{ readonly teamId: string; readonly sessionId: string } | undefined>(undefined);
	const sessionCreationRef = useRef<Promise<Awaited<ReturnType<typeof createTeamChatSession>>> | undefined>(undefined);
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
			if (loaded.document) setDocument(loaded.document);
			setSnapshot(loaded.snapshot);
			setContextUsages(readSnapshotContextUsages(loaded.snapshot));
			setSessions(loaded.sessions);
			setStatus("ready");
		},
		[teamId],
	);

	useEffect(() => {
		let cancelled = false;
		const loaded = loadedSessionRef.current;
		if (
			!createNewSession &&
			loaded?.teamId === teamId &&
			(!preferredSessionId || loaded.sessionId === preferredSessionId)
		)
			return;
		setStatus("loading");
		setError(undefined);
		setSnapshot(undefined);
		streamsRef.current = {};
		setStreams({});
		setPending(undefined);
		setSelectedMemberIds([]);
		setFailedMemberIds(new Set());
		setContextUsages({});
		setCompactingByRuntime({});
		void (async () => {
			try {
				if (createNewSession) {
					await waitForCommittedPaint();
					if (cancelled) return;
					const creation = createTeamChatSession(teamId);
					sessionCreationRef.current = creation;
					void loadTeamChatBootstrap(teamId)
						.then((bootstrap) => {
							if (cancelled) return;
							startTeamTransition(() => {
								setDocument(bootstrap.document);
								setSessions(bootstrap.sessions);
							});
						})
						.catch((cause: unknown) => {
							console.warn("[agent-team] deferred Team bootstrap failed", {
								teamId,
								error: errorMessage(cause),
							});
						});
					const created = await creation;
					if (cancelled) return;
					applyLoadedSession(created);
					notifyTeamSessionsChanged(teamId);
					return;
				}
				const opened = await loadTeamChatSession(teamId, preferredSessionId);
				if (cancelled) return;
				applyLoadedSession(opened);
			} catch (cause) {
				if (cancelled) return;
				setError(errorMessage(cause));
				setStatus("error");
			}
		})();
		return () => {
			cancelled = true;
			sessionCreationRef.current = undefined;
		};
	}, [teamId, preferredSessionId, createNewSession, applyLoadedSession]);

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
			notifyTeamSessionsChanged(teamId);
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
				setContextUsages((current) => ({ ...current, ...readSnapshotContextUsages(event.snapshot) }));
				setSnapshot((current) =>
					!current ||
					event.snapshot.session.revision > current.session.revision ||
					event.snapshot.conversationRevision >= current.conversationRevision
						? event.snapshot
						: current,
				);
			}
			if (event.type === "desktop.team-context-usage") {
				const currentSession = sessionRef.current;
				if (!currentSession) return;
				setContextUsages((current) => ({
					...current,
					[event.runtimeSessionId]: resolveTeamContextUsage(
						currentSession,
						event.runtimeSessionId,
						event.contextUsage,
					),
				}));
				if (event.isCompacting !== undefined) {
					setCompactingByRuntime((current) => ({
						...current,
						[event.runtimeSessionId]: event.isCompacting ?? false,
					}));
				}
			}
			if (event.type === "conversation.agent-message-event") {
				setFailedMemberIds((current) => {
					if (!current.has(event.author.id)) return current;
					const next = new Set(current);
					next.delete(event.author.id);
					return next;
				});
			} else if (event.type === "conversation.agent-message-discard" && event.reason === "failed") {
				setFailedMemberIds((current) => {
					if (current.has(event.author.id)) return current;
					return new Set([...current, event.author.id]);
				});
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
	const contextUsage = useMemo(() => {
		const leaderRuntimeId = memberRuntimeIds[session?.leaderMemberId ?? ""];
		const candidates = [activeContextRuntimeId, leaderRuntimeId, ...Object.values(memberRuntimeIds)].filter(
			(runtimeId, index, all): runtimeId is string => Boolean(runtimeId) && all.indexOf(runtimeId) === index,
		);
		for (const runtimeId of candidates) {
			const usage = contextUsages[runtimeId];
			if (usage) return usage;
		}
		return null;
	}, [activeContextRuntimeId, contextUsages, memberRuntimeIds, session?.leaderMemberId]);
	const isCompacting = useMemo(() => {
		if (activeContextRuntimeId && compactingByRuntime[activeContextRuntimeId] !== undefined) {
			return compactingByRuntime[activeContextRuntimeId] === true;
		}
		const leaderRuntimeId = memberRuntimeIds[session?.leaderMemberId ?? ""];
		return leaderRuntimeId ? compactingByRuntime[leaderRuntimeId] === true : false;
	}, [activeContextRuntimeId, compactingByRuntime, memberRuntimeIds, session?.leaderMemberId]);

	const members = useMemo(
		() =>
			resolveTeamMembers(
				document,
				team,
				selectedMemberIds,
				streams,
				(profileId, fallbackHandle) => {
					const profile = document?.agents.find((candidate) => candidate.id === profileId);
					return profile ? agentDisplayName(profile, t) : fallbackHandle;
				},
				failedMemberIds,
			),
		[document, failedMemberIds, selectedMemberIds, streams, t, team],
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
				memberId: memberViewId,
			}),
		[memberViewId, members, pending, snapshot, streams, t],
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
		if (!session && !createNewSession) return;
		const paths = await window.vetta.dialog.selectFiles(session?.cwd || undefined);
		addAttachments(paths.map(toFileAttachment));
	}, [addAttachments, createNewSession, session]);
	const selectImages = useCallback(async () => {
		if (!session && !createNewSession) return;
		const selected = await window.vetta.dialog.selectImages();
		const paths = await persistBase64Images(selected, session?.id ?? null, "image-dialog");
		addAttachments(paths.map(toImageAttachment));
	}, [addAttachments, createNewSession, session]);
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
		const attempt = {
			teamId,
			teamSessionId: session?.id,
			draftLength: draftText.length,
			attachmentCount: attachments.length,
			pendingRequestId: pendingRef.current?.requestId,
		};
		console.info("[agent-team] send attempted", attempt);
		if ((!session && !createNewSession) || (!draftText && attachments.length === 0) || pendingRef.current) {
			console.info("[agent-team] send ignored", {
				...attempt,
				reason:
					!session && !createNewSession
						? "session-unavailable"
						: !draftText && attachments.length === 0
							? "empty-input"
							: "request-pending",
			});
			return;
		}
		const text = draftText;
		const requestId = crypto.randomUUID();
		const sentAttachments = attachments;
		const targetMemberIds = team ? resolveMentionedMemberIds(team, text, selectedMemberIds) : [];
		const promptAttachments = attachments.map(toPromptAttachment);
		const nextPending = {
			requestId,
			text,
			displayText: draftText,
			attachments: promptAttachments,
			targetMemberIds,
			leaderMemberId: session?.leaderMemberId ?? team?.leaderMemberId ?? "leader",
			timestamp: Date.now(),
		};
		pendingRef.current = nextPending;
		setPending(nextPending);
		setStatus("sending");
		setError(undefined);
		setFailedMemberIds(new Set());
		const activeStreams = Object.fromEntries(
			Object.entries(streamsRef.current).filter(([, turn]) => turn.message.phase === "streaming"),
		);
		streamsRef.current = activeStreams;
		setStreams(activeStreams);
		updateDraft("");
		updateAttachments(() => []);
		const startedAt = Date.now();
		console.info("[agent-team] send-message IPC started", {
			teamId,
			teamSessionId: session?.id,
			requestId,
			targetMemberCount: targetMemberIds.length,
			attachmentCount: promptAttachments.length,
			modelKey: effectiveModelKey,
			reasoning: effectiveReasoning,
		});
		let activeSessionId = session?.id;
		try {
			const loaded = session
				? undefined
				: await (sessionCreationRef.current ?? createTeamChatSession(teamId, document, sessions));
			const readySession = session ?? loaded?.snapshot.session;
			if (!readySession) throw new Error("Team session is still preparing");
			activeSessionId = readySession.id;
			if (cancelledRequests.current.delete(requestId)) {
				setStatus("ready");
				return;
			}
			const next = await window.vetta.agentTeams.sendMessage(readySession.id, {
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
			setContextUsages((current) => ({ ...current, ...readSnapshotContextUsages(next) }));
			setError(undefined);
			setStatus("ready");
			console.info("[agent-team] send-message IPC completed", {
				teamId,
				teamSessionId: readySession.id,
				requestId,
				elapsedMs: Date.now() - startedAt,
			});
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
			console.error("[agent-team] send-message IPC failed", {
				teamId,
				teamSessionId: activeSessionId,
				requestId,
				elapsedMs: Date.now() - startedAt,
				error: cause instanceof Error ? cause.message : String(cause),
			});
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
		teamId,
		selectedMemberIds,
		session,
		team,
		draftScope,
		updateAttachments,
		updateDraft,
		effectiveModelKey,
		effectiveReasoning,
		createNewSession,
		document,
		sessions,
	]);

	const abort = useCallback(async () => {
		const request = pendingRef.current;
		if (!request) return;
		cancelledRequests.current.add(request.requestId);
		setStatus("cancelling");
		if (!session) {
			pendingRef.current = undefined;
			setPending(undefined);
			setStatus("ready");
			return;
		}
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
			memberRoles: {
				leader: t("blueprints.leader.name"),
				researcher: t("blueprints.researcher.name"),
				builder: t("blueprints.builder.name"),
				reviewer: t("blueprints.reviewer.name"),
			},
			memberRoleFallback: t("chat.member"),
			placeholder: t("chat.placeholder"),
			attachFile: t("chat.attachFile"),
			attachImage: t("chat.attachImage"),
		}),
		[t],
	);
	const model = useMemo<TeamChatViewModel>(
		() => ({
			feedKey: `${session?.id ?? teamId}:${memberViewId ?? "team"}`,
			title: team ? teamDisplayName(team, t) : t("teams.title"),
			status,
			draft,
			history,
			attachments,
			members,
			...(session?.leaderMemberId ? { leaderMemberId: session.leaderMemberId } : {}),
			feedItems,
			...(error ? { error } : {}),
			editorEnabled: Boolean(session || createNewSession) && !memberViewId,
			canSend: Boolean(
				(session || createNewSession) && !memberViewId && (draft.trim() || attachments.length > 0) && !pending,
			),
			workspace: session
				? createActivityWorkspace(session.workspaceId ?? `agent-team:${teamId}`, session.cwd)
				: null,
			activeSessionId: session?.id ?? null,
			runtimeSessionIds: session ? Object.values(session.memberRuntime).map((runtime) => runtime.sessionId) : [],
			memberRuntimeIds,
			...(memberViewId ? { memberViewId } : {}),
			executionMode: session?.executionMode ?? snapshot?.display?.executionMode ?? "full-access",
			contextUsage,
			contextUsagesByRuntime: contextUsages,
			compactingByRuntime,
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
			contextUsages,
			compactingByRuntime,
			isCompacting,
			memberRuntimeIds,
			memberViewId,
			createNewSession,
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

function readSnapshotContextUsages(
	snapshot: DesktopTeamSessionSnapshot,
): Readonly<Record<string, NonNullable<TeamChatViewModel["contextUsage"]>>> {
	const display = snapshot.display;
	const usages = display?.contextUsages ?? (display?.contextUsage ? [display.contextUsage] : []);
	return Object.fromEntries(
		usages.flatMap((usage) => {
			if (!usage.runtimeSessionId) return [];
			return [
				[usage.runtimeSessionId, resolveTeamContextUsage(snapshot.session, usage.runtimeSessionId, usage)],
			] as const;
		}),
	);
}

function resolveTeamContextUsage(
	session: DesktopTeamSessionSnapshot["session"],
	runtimeSessionId: string,
	usage: NonNullable<TeamChatViewModel["contextUsage"]>,
): NonNullable<TeamChatViewModel["contextUsage"]> {
	const runtime = Object.values(session.memberRuntime).find((candidate) => candidate.sessionId === runtimeSessionId);
	const composition = runtime
		? resolveSessionContextComposition(runtime.sessionPath, usage.composition)
		: usage.composition;
	return composition && !usage.composition ? { ...usage, composition } : usage;
}
