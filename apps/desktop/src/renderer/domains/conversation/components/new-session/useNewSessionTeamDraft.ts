import { agentDisplayName } from "@shared/agent-teams/agent-team-presentation";
import { deriveAttachments, parseInputSegments, pathTokenText, segmentsToText } from "@shared/lib/input-tokens";
import { persistBase64Images } from "@shared/lib/persist-input-images";
import { pathBasename } from "@shared/lib/utils";
import { reasoningByModelAtom, selectedModelAtom } from "@shared/store/atoms";
import type { AgentTeamDocument, SendTeamMessageInput, TeamDefinition } from "@vetta/agent-team";
import type { PromptAttachmentRef, SessionExecutionMode } from "@vetta/runtime-core";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { stageTeamSessionHandoff } from "../../connectors/team/team-session-handoff";
import {
	resolveTeamMembers,
	type TeamAttachmentViewModel,
	type TeamChatActions,
	type TeamChatViewModel,
} from "../../connectors/team/teamChatModel";
import { type NewSessionTargetKey, parseTeamTargetKey, teamTargetKey } from "./target";

interface NewSessionTeamDraftResult {
	readonly model: TeamChatViewModel | null;
	readonly actions: TeamChatActions | null;
	readonly loading: boolean;
	readonly error: string | null;
	readonly send: () => Promise<void>;
}

function toAttachment(path: string, kind: TeamAttachmentViewModel["kind"]): TeamAttachmentViewModel {
	return { path, name: pathBasename(path), kind };
}

export function useNewSessionTeamDraft(
	targetKey: NewSessionTargetKey | null,
	onSent: (sessionId: string) => void,
): NewSessionTeamDraftResult {
	const { t } = useTranslation(["agent-teams", "chat"]);
	const selectedModel = useAtomValue(selectedModelAtom);
	const reasoningByModel = useAtomValue(reasoningByModelAtom);
	const teamId = parseTeamTargetKey(targetKey);
	const [document, setDocument] = useState<AgentTeamDocument>();
	const [team, setTeam] = useState<TeamDefinition>();
	const [draftsByTeam, setDraftsByTeam] = useState<Readonly<Record<string, string>>>({});
	const [attachmentsByTeam, setAttachmentsByTeam] = useState<
		Readonly<Record<string, readonly TeamAttachmentViewModel[]>>
	>({});
	const [selectedMemberIds, setSelectedMemberIds] = useState<readonly string[]>([]);
	const [executionMode, setExecutionMode] = useState<SessionExecutionMode>("full-access");
	const [modelKey, setModelKey] = useState<string | null>(selectedModel);
	const [reasoning, setReasoning] = useState<string | undefined>(
		selectedModel ? reasoningByModel[selectedModel] : undefined,
	);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const loadRef = useRef<Promise<AgentTeamDocument> | null>(null);
	const activeTeamIdRef = useRef(teamId);
	activeTeamIdRef.current = teamId;
	const draft = teamId ? (draftsByTeam[teamId] ?? "") : "";
	const attachments = teamId ? (attachmentsByTeam[teamId] ?? []) : [];
	const updateDraft = useCallback(
		(update: string | ((current: string) => string)) => {
			if (!teamId) return;
			setDraftsByTeam((current) => {
				const previous = current[teamId] ?? "";
				const next = typeof update === "function" ? update(previous) : update;
				return next === previous ? current : { ...current, [teamId]: next };
			});
		},
		[teamId],
	);
	const updateAttachments = useCallback(
		(update: (current: readonly TeamAttachmentViewModel[]) => readonly TeamAttachmentViewModel[]) => {
			if (!teamId) return;
			setAttachmentsByTeam((current) => ({ ...current, [teamId]: update(current[teamId] ?? []) }));
		},
		[teamId],
	);
	const loadCatalog = useCallback((): Promise<AgentTeamDocument> => {
		if (document) return Promise.resolve(document);
		if (loadRef.current) return loadRef.current;
		setLoading(true);
		setError(null);
		const request = window.vetta.agentTeams
			.list()
			.then((next) => {
				if (activeTeamIdRef.current !== teamId) return next;
				setDocument(next);
				const found = next.teams.find((candidate) => candidate.id === teamId);
				setTeam(found);
				if (!found) setError(t("chat:newSession.agentSelector.invalid"));
				return next;
			})
			.catch((cause: unknown) => {
				if (activeTeamIdRef.current === teamId) setError(cause instanceof Error ? cause.message : String(cause));
				throw cause;
			})
			.finally(() => {
				loadRef.current = null;
				if (activeTeamIdRef.current === teamId) setLoading(false);
			});
		loadRef.current = request;
		return request;
	}, [document, t, teamId]);

	useEffect(() => {
		loadRef.current = null;
		if (!teamId) {
			setDocument(undefined);
			setTeam(undefined);
			setError(null);
			setLoading(false);
			return;
		}
		void loadCatalog().catch(() => undefined);
	}, [loadCatalog, teamId]);

	useEffect(() => {
		if (teamId) setSelectedMemberIds([]);
	}, [teamId]);

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
		(next: string) => {
			updateDraft(next);
			updateAttachments(() =>
				deriveAttachments(parseInputSegments(next).segments).map((attachment) =>
					toAttachment(attachment.path, attachment.kind === "image" ? "image" : "file"),
				),
			);
		},
		[updateAttachments, updateDraft],
	);
	const addAttachments = useCallback(
		(additions: readonly TeamAttachmentViewModel[]) => {
			const existing = new Set(attachments.map((attachment) => attachment.path));
			const fresh = additions.filter((attachment) => !existing.has(attachment.path));
			if (fresh.length === 0) return;
			updateAttachments((current) => [...current, ...fresh]);
			updateDraft((current) =>
				[...current.trimEnd(), ...fresh.map((attachment) => pathTokenText(attachment.path))]
					.filter(Boolean)
					.join(" "),
			);
		},
		[attachments, updateAttachments, updateDraft],
	);
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
		if (!teamId || pending || (!draft.trim() && attachments.length === 0)) return;
		setPending(true);
		setError(null);
		const requestId = crypto.randomUUID();
		const sentDraft = draft;
		const input: SendTeamMessageInput = {
			requestId,
			text: sentDraft.trim(),
			targetMemberIds: [],
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
			// Reserve the route identity locally. The destination page owns durable
			// creation and starts it only after the Team shell has painted.
			const sessionId = crypto.randomUUID();
			stageTeamSessionHandoff({
				sessionId,
				...(document ? { document } : {}),
				requestId,
				text: input.text,
				requestedMemberIds: selectedMemberIds,
				attachments: input.attachments ?? [],
				timestamp: Date.now(),
				...(input.modelKey ? { modelKey: input.modelKey } : {}),
				...(input.reasoning ? { reasoning: input.reasoning } : {}),
				executionMode,
			});
			onSent(sessionId);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setPending(false);
		}
	}, [attachments, document, draft, executionMode, modelKey, onSent, pending, reasoning, selectedMemberIds, teamId]);

	const actions = useMemo<TeamChatActions | null>(() => {
		if (!teamId) return null;
		return {
			setDraft: setDraftAndAttachments,
			selectLeader: () => setSelectedMemberIds([]),
			toggleMember: (memberId) =>
				setSelectedMemberIds((current) =>
					current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId],
				),
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
	}, [attachments, draft, error, executionMode, loading, members, modelKey, reasoning, t, team, teamId]);

	return { model, actions, loading, error, send };
}
