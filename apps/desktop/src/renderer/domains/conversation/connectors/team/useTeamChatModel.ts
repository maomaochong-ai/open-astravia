import type { DesktopTeamSessionSnapshot } from "@preload/api-types/team-conversation-display";
import { agentDisplayName, teamDisplayName } from "@shared/agent-teams/agent-team-presentation";
import { notifyTeamSessionsChanged } from "@shared/agent-teams/team-session-events";
import { abortConversationAgentMessage } from "@shared/conversation";
import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import {
	deriveAttachments,
	type InputSegment,
	parseInputSegments,
	pathTokenText,
	projectMemberMentionsToTrimmedText,
	type SerializedMemberMention,
	segmentsToText,
	serializeInputSegments,
} from "@shared/lib/input-tokens";
import { persistBase64Images } from "@shared/lib/persist-input-images";
import { pathBasename } from "@shared/lib/utils";
import { reasoningByModelAtom, selectedModelAtom } from "@shared/store/atoms";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";
import type { AgentTeamDocument, TeamSessionListItem } from "@vetta/agent-team";
import type { PromptAttachmentRef, SessionExecutionMode } from "@vetta/runtime-core";
import type { ConversationScenario } from "@vetta-org/plugin-sdk";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslation } from "react-i18next";
import { resolveSessionContextComposition } from "../../services/context-composition-cache";
import {
	createReservedTeamChatSession,
	createTeamChatSession,
	loadTeamChatBootstrap,
	loadTeamChatSession,
} from "./team-chat-session-service";
import {
	claimTeamSessionHandoff,
	clearTeamSessionHandoff,
	peekTeamSessionHandoff,
	releaseTeamSessionHandoff,
	type TeamSessionHandoff,
	type TeamSessionSendHandoff,
} from "./team-session-handoff";
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
	const [memberMentionsByTeam, setMemberMentionsByTeam] = useState<
		Readonly<Record<string, readonly SerializedMemberMention[]>>
	>({});
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
	const snapshotRef = useRef(snapshot);
	snapshotRef.current = snapshot;
	const loadedSessionRef = useRef<{ readonly teamId: string; readonly sessionId: string } | undefined>(undefined);
	const sessionCreationRef = useRef<Promise<Awaited<ReturnType<typeof createTeamChatSession>>> | undefined>(undefined);
	const cancelledRequests = useRef(new Set<string>());
	// A steer request is allowed while another request is still settling. Keep
	// every request identity so an earlier completion cannot clear the newer
	// request's pending state or flip the composer back to ready prematurely.
	const inFlightRequestIds = useRef(new Set<string>());
	const pendingRef = useRef<TeamPendingRequest | undefined>(undefined);
	const streamsRef = useRef<TeamStreamState>({});
	pendingRef.current = pending;
	const routeHandoff = preferredSessionId ? peekTeamSessionHandoff(preferredSessionId) : undefined;
	const displayDocument = routeHandoff?.document ?? document;
	const draftScope = session?.id ?? preferredSessionId ?? teamId;
	const draft = draftsByTeam[draftScope] ?? "";
	const draftRef = useRef(draft);
	draftRef.current = draft;
	const history = historyByTeam[draftScope] ?? [];
	const attachments = attachmentsByTeam[draftScope] ?? [];
	const memberMentions = memberMentionsByTeam[draftScope] ?? [];
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
		(next: string, segments?: readonly InputSegment[]) => {
			draftRef.current = next;
			updateDraft(next);
			const activeSegments = segments ?? parseInputSegments(next).segments;
			const serialized = segments ? serializeInputSegments(segments) : { text: next, memberMentions: [] };
			setMemberMentionsByTeam((current) => ({ ...current, [draftScope]: serialized.memberMentions }));
			setSelectedMemberIds([...new Set(serialized.memberMentions.map((mention) => mention.participantId))]);
			const derived = deriveAttachments(activeSegments).map((attachment) => ({
				path: attachment.path,
				name: pathBasename(attachment.path),
				kind: attachment.kind === "image" ? ("image" as const) : ("file" as const),
			}));
			updateAttachments(() => derived);
		},
		[draftScope, updateAttachments, updateDraft],
	);

	const team = useMemo(
		() => displayDocument?.teams.find((candidate) => candidate.id === teamId),
		[displayDocument, teamId],
	);
	const applyLoadedSession = useCallback(
		(loaded: Awaited<ReturnType<typeof loadTeamChatSession>>) => {
			loadedSessionRef.current = { teamId, sessionId: loaded.snapshot.session.id };
			if (loaded.document) setDocument(loaded.document);
			snapshotRef.current = loaded.snapshot;
			setSnapshot(loaded.snapshot);
			setContextUsages(readSnapshotContextUsages(loaded.snapshot));
			setSessions(loaded.sessions);
			setStatus(snapshotHasRunningWork(loaded.snapshot) ? "streaming" : "ready");
		},
		[teamId],
	);

	useEffect(() => {
		let cancelled = false;
		const loaded = loadedSessionRef.current;
		const handoff = preferredSessionId ? peekTeamSessionHandoff(preferredSessionId) : undefined;
		if (
			!handoff &&
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
		// StrictMode replays setup after the handoff send has acquired this state.
		// Keep that request alive until send settles; clearing it here makes the
		// feed empty when session creation releases the first-paint handoff.
		if (!handoff) {
			inFlightRequestIds.current.clear();
			pendingRef.current = undefined;
			setPending(undefined);
		}
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
				if (handoff) {
					if (handoff.document) setDocument(handoff.document);
					setSessions([]);
					setStatus("sending");
					await waitForCommittedPaint();
					if (cancelled) return;
					void loadTeamChatBootstrap(teamId)
						.then((bootstrap) => {
							if (cancelled) return;
							startTeamTransition(() => {
								setDocument(bootstrap.document);
								setSessions(bootstrap.sessions);
							});
						})
						.catch((cause: unknown) => {
							if (!cancelled) setError(errorMessage(cause));
						});
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
			// session-updated 用快照的 messages 把已落盘的 turn 从流里裁掉。这个裁剪
			// 必须和快照的采纳同进同退：快照因版本过旧被拒时若照裁不误，这条回复就从
			// 流和快照两边同时消失（页面重进才恢复）。
			// 只拦裁剪。session-snapshot 是用 activeMessageEvents 重建在跑的回合——
			// 那是流式首帧，跳过它会让正在进行的回合直到下一个事件才显形。
			let staleUpdatePrune = false;
			if (event.type === "session-snapshot" || event.type === "session-updated") {
				const current = snapshotRef.current;
				const titleChanged = event.snapshot.session.title !== current?.session.title;
				const stale =
					!!current &&
					event.snapshot.session.revision <= current.session.revision &&
					event.snapshot.conversationRevision < current.conversationRevision;
				staleUpdatePrune = stale && event.type === "session-updated";
				setContextUsages((cur) => ({ ...cur, ...readSnapshotContextUsages(event.snapshot) }));
				if (!stale) {
					snapshotRef.current = event.snapshot;
					setSnapshot(event.snapshot);
					if (titleChanged) {
						setSessions((current) =>
							current
								.map((item) =>
									item.id === event.teamSessionId
										? {
												...item,
												title: event.snapshot.session.title ?? "",
												updatedAt: event.snapshot.session.updatedAt,
											}
										: item,
								)
								.sort((left, right) => right.updatedAt - left.updatedAt),
						);
						notifyTeamSessionsChanged(teamId);
					}
				}
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
			const nextStreams = staleUpdatePrune ? streamsRef.current : reduceTeamStreamState(streamsRef.current, event);
			streamsRef.current = nextStreams;
			setStreams(nextStreams);
			const hasRunningTurn = Object.values(nextStreams).some((turn) => turn.message.phase === "streaming");
			if (
				event.type === "conversation.agent-message-event" ||
				event.type === "desktop.team-tool-execution" ||
				event.type === "conversation.tool-execution" ||
				hasRunningTurn ||
				snapshotHasRunningWork(snapshotRef.current)
			) {
				setStatus("streaming");
			} else if (event.type === "session-snapshot" || event.type === "session-updated") {
				setStatus(pendingRef.current ? "sending" : "ready");
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
	}, [session?.id, t, teamId]);

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
				displayDocument,
				team,
				selectedMemberIds,
				streams,
				(profileId, fallbackHandle) => {
					const profile = displayDocument?.agents.find((candidate) => candidate.id === profileId);
					return profile ? agentDisplayName(profile, t) : fallbackHandle;
				},
				failedMemberIds,
				snapshot?.display?.workingMemberIds ?? [],
			),
		[displayDocument, failedMemberIds, selectedMemberIds, snapshot?.display?.workingMemberIds, streams, t, team],
	);
	const stagedPending = useMemo(
		() => (routeHandoff ? pendingRequestFromHandoff(routeHandoff, team?.leaderMemberId ?? "leader") : undefined),
		[routeHandoff, team?.leaderMemberId],
	);
	const visiblePending = pending ?? stagedPending;
	const fallbackPendingTargetId = session?.leaderMemberId ?? visiblePending?.leaderMemberId ?? team?.leaderMemberId;
	const pendingTargetMemberIds =
		visiblePending?.targetMemberIds && visiblePending.targetMemberIds.length > 0
			? visiblePending.targetMemberIds
			: fallbackPendingTargetId
				? [fallbackPendingTargetId]
				: [];
	const pendingHasVisibleStream = visiblePending
		? Object.values(streams).some(
				(turn) => turn.message.turnId === visiblePending.requestId && turn.message.phase === "streaming",
			)
		: false;
	const pendingTargetsReady =
		pendingTargetMemberIds.length > 0 &&
		pendingTargetMemberIds.every((memberId) => Boolean(memberRuntimeIds[memberId]));
	const pendingLabel =
		visiblePending && !pendingHasVisibleStream
			? t(pendingTargetsReady ? "chat.waitingModel" : "chat.teamLoading")
			: undefined;
	const feedItems = useMemo(
		() =>
			projectTeamConversationTimeline({
				snapshot,
				pending: visiblePending,
				streams,
				members,
				labels: {
					delegation: (from, to) => t("chat.delegation", { from, to }),
					unknownMember: t("chat.member"),
				},
				memberId: memberViewId,
			}),
		[memberViewId, members, snapshot, streams, t, visiblePending],
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
		if (!session && !createNewSession && !preferredSessionId) return;
		const paths = await window.vetta.dialog.selectFiles(session?.cwd || undefined);
		addAttachments(paths.map(toFileAttachment));
	}, [addAttachments, createNewSession, preferredSessionId, session]);
	const selectImages = useCallback(async () => {
		if (!session && !createNewSession && !preferredSessionId) return;
		const selected = await window.vetta.dialog.selectImages();
		const paths = await persistBase64Images(selected, session?.id ?? null, "image-dialog");
		addAttachments(paths.map(toImageAttachment));
	}, [addAttachments, createNewSession, preferredSessionId, session]);
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

	const send = useCallback(
		async (
			handoffOrBehavior?: TeamSessionSendHandoff | "steer" | "followUp",
			explicitBehavior?: "steer" | "followUp",
		) => {
			const handoff = typeof handoffOrBehavior === "string" ? undefined : handoffOrBehavior;
			const streamingBehavior = typeof handoffOrBehavior === "string" ? handoffOrBehavior : explicitBehavior;
			const activeHandoff =
				handoff ?? (!session && preferredSessionId ? claimTeamSessionHandoff(preferredSessionId) : undefined);
			const draftText = (activeHandoff?.text ?? draft).trim();
			const attempt = {
				teamId,
				teamSessionId: session?.id,
				draftLength: draftText.length,
				attachmentCount: activeHandoff?.attachments.length ?? attachments.length,
				pendingRequestId: pendingRef.current?.requestId,
			};
			console.info("[agent-team] send attempted", attempt);
			if (
				(!session && !createNewSession && !activeHandoff) ||
				(!draftText && (activeHandoff?.attachments.length ?? attachments.length) === 0) ||
				(inFlightRequestIds.current.size > 0 && streamingBehavior !== "steer")
			) {
				console.info("[agent-team] send ignored", {
					...attempt,
					reason:
						!session && !createNewSession && !activeHandoff
							? "session-unavailable"
							: !draftText && (activeHandoff?.attachments.length ?? attachments.length) === 0
								? "empty-input"
								: "request-pending",
				});
				return;
			}
			const text = draftText;
			const requestId = activeHandoff?.requestId ?? crypto.randomUUID();
			const sentAttachments = activeHandoff
				? activeHandoff.attachments.map((attachment) => ({
						path: attachment.path,
						name: pathBasename(attachment.path),
						kind: attachment.kind === "image" ? ("image" as const) : ("file" as const),
					}))
				: attachments;
			const sentMemberMentions = projectMemberMentionsToTrimmedText(
				activeHandoff?.text ?? draft,
				text,
				activeHandoff?.memberMentions ?? memberMentions,
			);
			const targetMemberIds = [...new Set(sentMemberMentions.map((mention) => mention.participantId))];
			const promptAttachments = activeHandoff?.attachments ?? attachments.map(toPromptAttachment);
			const requestModelKey = activeHandoff?.modelKey ?? effectiveModelKey;
			const requestReasoning = activeHandoff?.reasoning ?? effectiveReasoning;
			const nextPending = {
				requestId,
				text,
				displayText: draftText,
				attachments: promptAttachments,
				targetMemberIds,
				memberMentions: sentMemberMentions,
				leaderMemberId: session?.leaderMemberId ?? team?.leaderMemberId ?? "leader",
				timestamp: activeHandoff?.timestamp ?? Date.now(),
			};
			pendingRef.current = nextPending;
			inFlightRequestIds.current.add(requestId);
			setPending(nextPending);
			setStatus("sending");
			setError(undefined);
			setFailedMemberIds(new Set());
			// A stopped turn may have only a pre-tool record in public history. Its
			// tool end is display-only stream evidence, so keep that terminal overlay
			// across the next send; otherwise the historical block falls back to the
			// persisted toolUse record and falsely appears to be running again.
			const activeStreams = Object.fromEntries(
				Object.entries(streamsRef.current).filter(
					([, turn]) =>
						turn.message.phase === "streaming" ||
						turn.message.blocks.some((block) => block.type === "tool_call" && block.status !== "pending"),
				),
			);
			streamsRef.current = activeStreams;
			setStreams(activeStreams);
			updateDraft("");
			draftRef.current = "";
			setMemberMentionsByTeam((current) => ({ ...current, [draftScope]: [] }));
			setSelectedMemberIds([]);
			updateAttachments(() => []);
			const startedAt = Date.now();
			console.info("[agent-team] send-message IPC started", {
				teamId,
				teamSessionId: session?.id,
				requestId,
				targetMemberCount: targetMemberIds.length,
				attachmentCount: promptAttachments.length,
				modelKey: requestModelKey,
				reasoning: requestReasoning,
			});
			let activeSessionId = session?.id;
			try {
				if (activeHandoff) await waitForCommittedPaint();
				const loaded = session
					? undefined
					: activeHandoff
						? await createReservedTeamChatSession({
								teamId,
								sessionId: activeHandoff.sessionId,
								executionMode: activeHandoff.executionMode,
								document: displayDocument,
								...(activeHandoff.workspace ? { workspace: activeHandoff.workspace } : {}),
							})
						: await (sessionCreationRef.current ?? createTeamChatSession(teamId, document, sessions));
				const readySession = session ?? loaded?.snapshot.session;
				if (!readySession) throw new Error("Team session is still preparing");
				activeSessionId = readySession.id;
				if (activeHandoff && loaded) {
					loadedSessionRef.current = { teamId, sessionId: readySession.id };
					if (loaded.document) setDocument(loaded.document);
					setSnapshot(loaded.snapshot);
					setContextUsages(readSnapshotContextUsages(loaded.snapshot));
					setSessions(loaded.sessions);
					notifyTeamSessionsChanged(teamId);
					await waitForCommittedPaint();
					clearTeamSessionHandoff(activeHandoff.sessionId);
				}
				if (cancelledRequests.current.delete(requestId)) {
					setStatus("ready");
					return;
				}
				const next = await window.vetta.agentTeams.sendMessage(readySession.id, {
					requestId,
					text,
					memberMentions: sentMemberMentions,
					targetMemberIds,
					...(promptAttachments.length ? { attachments: promptAttachments } : {}),
					...(requestModelKey ? { modelKey: requestModelKey } : {}),
					...(requestReasoning ? { reasoning: requestReasoning } : {}),
					...(streamingBehavior ? { streamingBehavior } : {}),
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
				if (inFlightRequestIds.current.size <= 1) setStatus("ready");
				notifyTeamSessionsChanged(teamId);
				console.info("[agent-team] send-message IPC completed", {
					teamId,
					teamSessionId: readySession.id,
					requestId,
					elapsedMs: Date.now() - startedAt,
				});
				if (text) {
					setHistoryByTeam((current) => {
						const previous = current[draftScope] ?? [];
						return {
							...current,
							[draftScope]: [...previous.filter((item) => item !== text), text].slice(-50),
						};
					});
				}
			} catch (cause) {
				if (activeHandoff && !activeSessionId) releaseTeamSessionHandoff(activeHandoff.sessionId);
				console.error("[agent-team] send-message IPC failed", {
					teamId,
					teamSessionId: activeSessionId,
					requestId,
					elapsedMs: Date.now() - startedAt,
					error: cause instanceof Error ? cause.message : String(cause),
				});
				if (cancelledRequests.current.delete(requestId)) {
					if (inFlightRequestIds.current.size <= 1) setStatus("ready");
				} else {
					setError(errorMessage(cause));
					if (inFlightRequestIds.current.size <= 1) setStatus("error");
				}
				const restoreSubmittedDraft = draftRef.current.length === 0;
				updateDraft((current) => current || draftText);
				if (restoreSubmittedDraft) {
					draftRef.current = draftText;
					setMemberMentionsByTeam((current) => ({ ...current, [draftScope]: sentMemberMentions }));
					setSelectedMemberIds([...new Set(sentMemberMentions.map((mention) => mention.participantId))]);
				}
				updateAttachments((current) => mergeAttachments(current, sentAttachments));
			} finally {
				inFlightRequestIds.current.delete(requestId);
				if (pendingRef.current?.requestId === requestId) pendingRef.current = undefined;
				setPending((current) => (current?.requestId === requestId ? undefined : current));
				if (inFlightRequestIds.current.size > 0) setStatus("sending");
			}
		},
		[
			attachments,
			draft,
			teamId,
			memberMentions,
			session,
			team,
			draftScope,
			updateAttachments,
			updateDraft,
			effectiveModelKey,
			effectiveReasoning,
			createNewSession,
			document,
			displayDocument,
			preferredSessionId,
			sessions,
		],
	);

	useEffect(() => {
		if (createNewSession || !preferredSessionId) return;
		const handoff = claimTeamSessionHandoff(preferredSessionId);
		if (!handoff) return;
		void send(handoff);
	}, [createNewSession, preferredSessionId, send]);

	// 终止是最高优先级动作：无论本地是否还持有在飞的 send 请求（leader 的 IPC 早已
	// 返回，成员任务仍在跑），都必须发出终止并立刻解锁输入。本地状态不等流事件回灌。
	const abort = useCallback(async () => {
		const request = pendingRef.current;
		const target = sessionRef.current;
		for (const requestId of inFlightRequestIds.current) cancelledRequests.current.add(requestId);
		if (request && inFlightRequestIds.current.size === 0) cancelledRequests.current.add(request.requestId);
		setStatus("cancelling");
		inFlightRequestIds.current.clear();
		pendingRef.current = undefined;
		setPending(undefined);
		const abortedStreams = Object.fromEntries(
			Object.entries(streamsRef.current).map(([messageId, turn]) =>
				turn.message.phase === "streaming"
					? [messageId, { ...turn, message: abortConversationAgentMessage(turn.message, Date.now()) }]
					: [messageId, turn],
			),
		);
		streamsRef.current = abortedStreams;
		setStreams(abortedStreams);
		setStatus("ready");
		if (!target) return;
		try {
			await window.vetta.agentTeams.abort(target.id);
		} catch (cause) {
			if (request) cancelledRequests.current.delete(request.requestId);
			setError(errorMessage(cause));
			setStatus("error");
		}
	}, []);

	const labels = useMemo(
		() => ({
			leaderRoute: t("chat.leaderRoute"),
			// 按 blueprintId 取角色名；下线的 leader / builder / reviewer 仍留在老档案里，映射到接替者。
			memberRoles: {
				master: t("blueprints.master.name"),
				researcher: t("blueprints.researcher.name"),
				architect: t("blueprints.architect.name"),
				executor: t("blueprints.executor.name"),
				auditor: t("blueprints.auditor.name"),
				optimizer: t("blueprints.optimizer.name"),
				synthesizer: t("blueprints.synthesizer.name"),
				translator: t("blueprints.translator.name"),
				leader: t("blueprints.master.name"),
				builder: t("blueprints.executor.name"),
				reviewer: t("blueprints.auditor.name"),
			},
			memberRoleFallback: t("chat.member"),
			placeholder: t("chat.placeholder"),
			attachFile: t("chat.attachFile"),
			attachImage: t("chat.attachImage"),
		}),
		[t],
	);
	// 活动面板按会话本身取数：看团队全景时聚合协调与全部成员 Runtime，进入某个成员
	// 视图时收窄到该成员，避免 Todo / 后台任务把别人的执行状态算进来。
	const activityRuntimeIds = useMemo(() => {
		if (!session) return [];
		if (memberViewId) {
			const runtimeId = memberRuntimeIds[memberViewId];
			return runtimeId ? [runtimeId] : [];
		}
		const coordination = session.coordinationRuntime?.sessionId;
		return [
			...(coordination ? [coordination] : []),
			...Object.values(session.memberRuntime).map((runtime) => runtime.sessionId),
		];
	}, [session, memberViewId, memberRuntimeIds]);
	// 与 Runtime 对齐，而不是按工作空间派生：Team 的协调与成员 Runtime 都由
	// resolveDesktopSessionConfig 以 kind "other" 建会话，场景恒为 "project"。UI 若按
	// 自有工作空间标成 "conversation"，scope_use:["project"] 的插件就会出现「工具在
	// Team 里可用、页签却永不上栏」的错位（scope_use 是 fail-closed 的）。
	const pluginScenario: ConversationScenario = "project";

	const model = useMemo<TeamChatViewModel>(
		() => ({
			feedKey: `${session?.id ?? preferredSessionId ?? teamId}:${memberViewId ?? "team"}`,
			title: team ? teamDisplayName(team, t) : t("teams.title"),
			status: routeHandoff && !session ? "sending" : status,
			draft,
			draftMemberMentions: memberMentions,
			history,
			attachments,
			members,
			...(session?.leaderMemberId ? { leaderMemberId: session.leaderMemberId } : {}),
			feedItems,
			...(pendingLabel ? { pendingLabel } : {}),
			...(error ? { error } : {}),
			editorEnabled: Boolean(session || createNewSession || preferredSessionId) && !memberViewId,
			canSend: Boolean(
				(session || createNewSession || preferredSessionId) &&
					!memberViewId &&
					(draft.trim() || attachments.length > 0) &&
					!visiblePending,
			),
			workspace: createActivityWorkspace(
				session?.workspaceId ?? `agent-team:${teamId}`,
				session?.cwd ?? null,
				activityRuntimeIds,
			),
			pluginScenario,
			activeSessionId: session?.id ?? (routeHandoff || pending ? (preferredSessionId ?? null) : null),
			runtimeSessionIds: session ? Object.values(session.memberRuntime).map((runtime) => runtime.sessionId) : [],
			memberRuntimeIds,
			...(memberViewId ? { memberViewId } : {}),
			executionMode:
				session?.executionMode ?? routeHandoff?.executionMode ?? snapshot?.display?.executionMode ?? "full-access",
			contextUsage,
			contextUsagesByRuntime: contextUsages,
			compactingByRuntime,
			isCompacting,
			modelKey: effectiveModelKey,
			...(effectiveReasoning ? { reasoning: effectiveReasoning } : {}),
			sessions: sessions.map((item, index) => ({
				id: item.id,
				label: item.title || t("chat.sessionLabel", { index: sessions.length - index }),
			})),
			sessionActionsDisabled: status === "loading" || Boolean(visiblePending),
			labels,
		}),
		[
			teamId,
			team,
			t,
			status,
			draft,
			memberMentions,
			history,
			attachments,
			members,
			feedItems,
			pendingLabel,
			error,
			session,
			pending,
			preferredSessionId,
			routeHandoff,
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
			visiblePending,
			activityRuntimeIds,
		],
	);
	const actions = useMemo<TeamChatActions>(
		() => ({
			setDraft,
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

function pendingRequestFromHandoff(handoff: TeamSessionHandoff, leaderMemberId: string): TeamPendingRequest {
	return {
		requestId: handoff.requestId,
		text: handoff.text,
		displayText: handoff.text,
		attachments: handoff.attachments,
		targetMemberIds: [...new Set(handoff.memberMentions.map((mention) => mention.participantId))],
		memberMentions: handoff.memberMentions,
		leaderMemberId,
		timestamp: handoff.timestamp,
	};
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function snapshotHasRunningWork(snapshot: DesktopTeamSessionSnapshot | undefined): boolean {
	return (snapshot?.display?.workingMemberIds?.length ?? 0) > 0;
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
