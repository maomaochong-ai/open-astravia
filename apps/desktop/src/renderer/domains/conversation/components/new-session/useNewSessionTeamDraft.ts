import { agentDisplayName } from "@shared/agent-teams/agent-team-presentation";
import {
	deriveAttachments,
	type InputSegment,
	parseInputSegments,
	pathTokenText,
	projectMemberMentionsToTrimmedText,
	segmentsToText,
	serializeInputSegments,
} from "@shared/lib/input-tokens";
import { persistBase64Images } from "@shared/lib/persist-input-images";
import { pathBasename } from "@shared/lib/utils";
import {
	clearCurrentSessionInputDraft,
	inputValueAtom,
	reasoningByModelAtom,
	selectedModelAtom,
} from "@shared/store/atoms";
import type { AgentTeamDocument, SendTeamMessageInput, TeamDefinition } from "@vetta/agent-team";
import type { PromptAttachmentRef, SessionExecutionMode } from "@vetta/runtime-core";
import { useAtomValue, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { stageTeamSessionHandoff } from "../../connectors/team/team-session-handoff";
import {
	resolveTeamMembers,
	type TeamAttachmentViewModel,
	type TeamChatActions,
	type TeamChatViewModel,
} from "../../connectors/team/teamChatModel";
import type { ProjectSelection } from "./project-selector/project-selection";
import { type NewSessionTargetKey, parseTeamTargetKey, teamTargetKey } from "./target";
import {
	rebaseTeamDraftMemberMentions,
	rebaseTeamDraftMentionRecord,
	type TeamDraftMemberMentions,
} from "./team-draft-member-mentions";

interface NewSessionTeamDraftResult {
	readonly model: TeamChatViewModel | null;
	readonly actions: TeamChatActions | null;
	readonly loading: boolean;
	readonly error: string | null;
	readonly send: () => Promise<void>;
}

interface NewSessionTeamDraftOptions {
	readonly targetKey: NewSessionTargetKey | null;
	readonly projectSelection: ProjectSelection;
	readonly prepareCwd: () => Promise<string | null>;
	readonly onSent: (sessionId: string) => void;
}

function toAttachment(path: string, kind: TeamAttachmentViewModel["kind"]): TeamAttachmentViewModel {
	return { path, name: pathBasename(path), kind };
}

export function useNewSessionTeamDraft({
	targetKey,
	projectSelection,
	prepareCwd,
	onSent,
}: NewSessionTeamDraftOptions): NewSessionTeamDraftResult {
	const { t } = useTranslation(["agent-teams", "chat"]);
	const selectedModel = useAtomValue(selectedModelAtom);
	const reasoningByModel = useAtomValue(reasoningByModelAtom);
	const store = useStore();
	const teamId = parseTeamTargetKey(targetKey);
	const [document, setDocument] = useState<AgentTeamDocument>();
	const memberMentionsByTeamRef = useRef<Readonly<Record<string, TeamDraftMemberMentions>>>({});
	const [, refreshMemberMentions] = useReducer((revision: number) => revision + 1, 0);
	const [executionMode, setExecutionMode] = useState<SessionExecutionMode>("full-access");
	const [modelKey, setModelKey] = useState<string | null>(selectedModel);
	const [reasoning, setReasoning] = useState<string | undefined>(
		selectedModel ? reasoningByModel[selectedModel] : undefined,
	);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const sendingRef = useRef(false);
	const loadRef = useRef<Promise<AgentTeamDocument> | null>(null);
	const subscribeToDraft = useCallback(
		(onStoreChange: () => void) => (teamId ? store.sub(inputValueAtom, onStoreChange) : () => undefined),
		[store, teamId],
	);
	const readDraft = useCallback(() => store.get(inputValueAtom), [store]);
	const draft = useSyncExternalStore(subscribeToDraft, readDraft, readDraft);
	const team = useMemo<TeamDefinition | undefined>(
		() => (teamId ? document?.teams.find((candidate) => candidate.id === teamId) : undefined),
		[document, teamId],
	);
	const memberMentionRecord = teamId ? memberMentionsByTeamRef.current[teamId] : undefined;
	const memberMentions = useMemo(
		() =>
			memberMentionRecord
				? rebaseTeamDraftMemberMentions(memberMentionRecord.sourceText, draft, memberMentionRecord.mentions)
				: [],
		[draft, memberMentionRecord],
	);
	const selectedMemberIds = useMemo(
		() => [...new Set(memberMentions.map((mention) => mention.participantId))],
		[memberMentions],
	);
	const attachments = useMemo(
		() =>
			deriveAttachments(parseInputSegments(draft).segments).map((attachment) =>
				toAttachment(attachment.path, attachment.kind === "image" ? "image" : "file"),
			),
		[draft],
	);

	useEffect(() => {
		let previousText = store.get(inputValueAtom);
		return store.sub(inputValueAtom, () => {
			const nextText = store.get(inputValueAtom);
			if (nextText === previousText) return;
			previousText = nextText;
			memberMentionsByTeamRef.current = Object.fromEntries(
				Object.entries(memberMentionsByTeamRef.current).map(([id, record]) => [
					id,
					rebaseTeamDraftMentionRecord(record, nextText),
				]),
			);
		});
	}, [store]);

	const updateDraft = useCallback(
		(update: string | ((current: string) => string)) => {
			if (!teamId) return;
			const previous = store.get(inputValueAtom);
			const next = typeof update === "function" ? update(previous) : update;
			store.set(inputValueAtom, next);
		},
		[store, teamId],
	);
	const loadCatalog = useCallback((): Promise<AgentTeamDocument> => {
		if (document) return Promise.resolve(document);
		if (loadRef.current) return loadRef.current;
		setLoading(true);
		setError(null);
		const request = window.vetta.agentTeams
			.list()
			.then((next) => {
				setDocument(next);
				return next;
			})
			.catch((cause: unknown) => {
				setError(cause instanceof Error ? cause.message : String(cause));
				throw cause;
			})
			.finally(() => {
				loadRef.current = null;
				setLoading(false);
			});
		loadRef.current = request;
		return request;
	}, [document]);

	useEffect(() => {
		if (!teamId) {
			setError(null);
			return;
		}
		if (document) {
			setError(team ? null : t("chat:newSession.agentSelector.invalid"));
			return;
		}
		void loadCatalog().catch(() => undefined);
	}, [document, loadCatalog, t, team, teamId]);

	useEffect(() => {
		setModelKey(selectedModel);
		setReasoning(selectedModel ? reasoningByModel[selectedModel] : undefined);
	}, [reasoningByModel, selectedModel]);

	const members = useMemo(
		() =>
			resolveTeamMembers(document, team, selectedMemberIds, {}, (profileId, fallback) => {
				const profile = document?.agents.find((candidate) => candidate.id === profileId);
				return profile ? agentDisplayName(profile, t) : fallback;
			}),
		[document, selectedMemberIds, t, team],
	);
	const setDraftAndAttachments = useCallback(
		(next: string, segments?: readonly InputSegment[]) => {
			if (!teamId) return;
			const previousRecord = memberMentionsByTeamRef.current[teamId] ?? { sourceText: draft, mentions: [] };
			const serialized = segments ? serializeInputSegments(segments) : null;
			const nextRecord: TeamDraftMemberMentions =
				serialized?.text === next
					? { sourceText: next, mentions: serialized.memberMentions }
					: rebaseTeamDraftMentionRecord(previousRecord, next);
			memberMentionsByTeamRef.current = {
				...memberMentionsByTeamRef.current,
				[teamId]: nextRecord,
			};
			store.set(inputValueAtom, next);
			refreshMemberMentions();
		},
		[draft, store, teamId],
	);
	const addAttachments = useCallback(
		(additions: readonly TeamAttachmentViewModel[]) => {
			const existing = new Set(attachments.map((attachment) => attachment.path));
			const fresh = additions.filter((attachment) => !existing.has(attachment.path));
			if (fresh.length === 0) return;
			updateDraft((current) =>
				[...current.trimEnd(), ...fresh.map((attachment) => pathTokenText(attachment.path))]
					.filter(Boolean)
					.join(" "),
			);
		},
		[attachments, updateDraft],
	);
	const removeAttachment = useCallback(
		(path: string) => {
			updateDraft((current) =>
				segmentsToText(
					parseInputSegments(current).segments.filter(
						(segment) => !((segment.kind === "file" || segment.kind === "image") && segment.path === path),
					),
				),
			);
		},
		[updateDraft],
	);

	const send = useCallback(async () => {
		if (!teamId || sendingRef.current || (!draft.trim() && attachments.length === 0)) return;
		sendingRef.current = true;
		setError(null);
		const requestId = crypto.randomUUID();
		const sentDraft = draft;
		const text = sentDraft.trim();
		const sentMemberMentions = projectMemberMentionsToTrimmedText(sentDraft, text, memberMentions);
		const input: SendTeamMessageInput = {
			requestId,
			text,
			memberMentions: sentMemberMentions,
			targetMemberIds: [...new Set(sentMemberMentions.map((mention) => mention.participantId))],
			...(attachments.length > 0
				? {
						attachments: attachments.map(
							(attachment): PromptAttachmentRef => ({ kind: attachment.kind, path: attachment.path }),
						),
					}
				: {}),
			...(modelKey ? { modelKey } : {}),
			...(reasoning ? { reasoning } : {}),
		};
		try {
			const projectCwd = projectSelection ? await prepareCwd() : undefined;
			if (projectSelection && !projectCwd) return;
			// Reserve the route identity locally. The destination page owns durable
			// creation and starts it only after the Team shell has painted.
			const sessionId = crypto.randomUUID();
			stageTeamSessionHandoff({
				sessionId,
				...(document ? { document } : {}),
				requestId,
				text: input.text,
				memberMentions: sentMemberMentions,
				attachments: input.attachments ?? [],
				timestamp: Date.now(),
				...(input.modelKey ? { modelKey: input.modelKey } : {}),
				...(input.reasoning ? { reasoning: input.reasoning } : {}),
				executionMode,
				...(projectCwd ? { workspace: { kind: "project", path: projectCwd } as const } : {}),
			});
			// Project preparation may take long enough for the user to continue
			// typing. Clear only the exact snapshot that was handed off.
			if (store.get(inputValueAtom) === sentDraft) {
				memberMentionsByTeamRef.current = {};
				clearCurrentSessionInputDraft();
				refreshMemberMentions();
			}
			onSent(sessionId);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			sendingRef.current = false;
		}
	}, [
		attachments,
		document,
		draft,
		executionMode,
		modelKey,
		onSent,
		prepareCwd,
		projectSelection,
		reasoning,
		memberMentions,
		store,
		teamId,
	]);

	const actions = useMemo<TeamChatActions | null>(() => {
		if (!teamId) return null;
		return {
			setDraft: setDraftAndAttachments,
			selectFiles: async () =>
				addAttachments((await window.vetta.dialog.selectFiles()).map((path) => toAttachment(path, "file"))),
			selectImages: async () =>
				addAttachments(
					(await persistBase64Images(await window.vetta.dialog.selectImages(), null, "image-dialog")).map((path) =>
						toAttachment(path, "image"),
					),
				),
			removeAttachment,
			addAttachments,
			send,
			abort: async () => undefined,
			createSession: async () => undefined,
			openSession: async () => undefined,
			selectModel: async (next, defaultReasoning) => {
				setModelKey(next);
				setReasoning(reasoningByModel[next] ?? defaultReasoning);
			},
			selectReasoning: async (next) => {
				setReasoning(next);
			},
			setExecutionMode: async (next: SessionExecutionMode) => {
				setExecutionMode(next);
			},
		};
	}, [addAttachments, reasoningByModel, removeAttachment, send, setDraftAndAttachments, teamId]);

	const model = useMemo<TeamChatViewModel | null>(() => {
		if (!teamId) return null;
		return {
			feedKey: `new:${teamTargetKey(teamId)}`,
			title: team?.name ?? t("agent-teams:teams.title"),
			// `pending` is an internal handoff guard only. It must not turn the
			// pre-session editor into a streaming/disabled input state.
			status: loading ? "loading" : error ? "error" : "ready",
			draft,
			draftMemberMentions: memberMentions,
			history: [],
			attachments,
			members,
			...(team?.leaderMemberId ? { leaderMemberId: team.leaderMemberId } : {}),
			feedItems: [],
			error: error ?? undefined,
			// Sending a snapshot must not freeze the composer. A later edit belongs to
			// the next turn and cannot mutate the already captured request payload.
			editorEnabled: true,
			canSend: Boolean(draft.trim() || attachments.length),
			workspace: null,
			// 会话尚未创建，工作空间为空，面板不渲染；场景与 Team Runtime 一致。
			pluginScenario: "project",
			activeSessionId: null,
			executionMode,
			contextUsage: null,
			sessions: [],
			sessionActionsDisabled: true,
			modelKey,
			reasoning,
			labels: {
				leaderRoute: t("agent-teams:chat.leaderRoute"),
				memberRoleFallback: t("agent-teams:chat.member"),
				placeholder: t("agent-teams:chat.placeholder"),
				attachFile: t("agent-teams:chat.attachFile"),
				attachImage: t("agent-teams:chat.attachImage"),
			},
		};
	}, [
		attachments,
		draft,
		error,
		executionMode,
		loading,
		memberMentions,
		members,
		modelKey,
		reasoning,
		t,
		team,
		teamId,
	]);

	return { model, actions, loading, error, send };
}
