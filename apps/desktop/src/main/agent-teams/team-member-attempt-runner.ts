import {
	type AgentTeamDocument,
	type AgentTeamExtensionRegistry,
	classifyTeamAttemptTerminal,
	classifyTeamExecutionIssue,
	markTeamMemberContextDelivered,
	type TeamMemberTurnAttempt,
	type TeamMemberTurnAttemptMode,
	type TeamObservationPublisher,
	type TeamSessionDocument,
	type TeamWorkItem,
	teamMemberResultMessageId,
} from "@vetta/agent-team";
import { type AssistantMessage, isAIError } from "@vetta/ai";
import {
	type HistoryEntry,
	type PromptAttachmentRef,
	type RuntimeHost,
	readRuntimeFailure,
	runtimeFailureFromError,
} from "@vetta/runtime-core";
import { getAppLogger } from "../logger.js";
import type { TeamCollaborationStore } from "./team-collaboration-store.js";
import { findTeamAttemptFailure, findTeamAttemptResult, isTeamAttemptFinalResult } from "./team-member-result.js";
import type { TeamMemberTurnRequest } from "./team-member-turn-request.js";
import { TeamNotificationJournal, undeliveredTeamNotifications } from "./team-notification-journal.js";
import { publicAssistantMessage } from "./team-public-message.js";
import type { TeamPublicationWorkflow } from "./team-publication-workflow.js";
import type { TeamRuntimeManager } from "./team-runtime-manager.js";
import type { TeamSessionEventHub } from "./team-session-event-hub.js";
import type { TeamSessionStateRepository } from "./team-session-state-repository.js";
import type { TeamSharedContextService } from "./team-shared-context-service.js";

const log = getAppLogger("agent-team-member-turns");

type AttemptTerminal = ReturnType<typeof classifyTeamAttemptTerminal>;

export interface TeamMemberAttemptRunnerOptions {
	readonly extensions: AgentTeamExtensionRegistry;
	readonly collaborationStore: TeamCollaborationStore;
	readonly sharedContextService: TeamSharedContextService;
	readonly publicationWorkflow: TeamPublicationWorkflow;
	readonly eventHub: TeamSessionEventHub;
	readonly runtimeManager: TeamRuntimeManager;
	readonly sessionState: TeamSessionStateRepository;
	readonly runtime: () => RuntimeHost;
	readonly readDocument: () => Promise<AgentTeamDocument>;
	readonly observations: (session: TeamSessionDocument) => TeamObservationPublisher | undefined;
	readonly publishSessionUpdated: (session: TeamSessionDocument) => void;
	readonly settleAttempt: (
		session: TeamSessionDocument,
		workItem: TeamWorkItem,
		attempt: TeamMemberTurnAttempt,
		terminal: AttemptTerminal,
		resultMessageId?: string,
	) => Promise<TeamWorkItem>;
}

/** Executes one admitted member attempt, including context delivery and public result publication. */
export class TeamMemberAttemptRunner {
	constructor(private readonly options: TeamMemberAttemptRunnerOptions) {}
	async run(input: TeamMemberTurnRequest): Promise<TeamSessionDocument> {
		const {
			memberId,
			promptText,
			requestId,
			sourceTurnId,
			createdByParticipantId,
			attachments,
			mode = "initial",
		} = input;
		const document = await this.options.readDocument();
		const configuredSession = await this.options.sessionState.coordinateLoaded(input.teamSessionId, (current) =>
			this.options.runtimeManager.ensureMemberConfiguration(current, document, memberId),
		);
		const collaboration = await this.beginMemberAttempt({
			session: configuredSession,
			memberId,
			requestId,
			sourceTurnId,
			createdByParticipantId,
			objective: promptText,
			notificationIds: input.notificationIds,
			...(attachments?.length ? { attachments } : {}),
			...(input.workItemKind ? { kind: input.workItemKind } : {}),
			mode,
		});
		log.info("team member turn admitted", {
			teamSessionId: configuredSession.id,
			memberId,
			requestId,
			workItemId: collaboration.workItem.id,
			attemptId: collaboration.attempt.id,
			mode,
		});
		try {
			return await this.executeMemberAttempt(configuredSession, input, collaboration);
		} catch (error) {
			// Projection/admission/persistence can fail outside the model call. Never leave
			// an attempt running after its execution lane has actually been released.
			const current = this.options.collaborationStore
				.read(configuredSession)
				.workItems.find((item) => item.id === collaboration.workItem.id);
			const cancelled = input.signal?.aborted === true || current?.state === "cancelled";
			if (current?.state === "running" && current.currentAttemptId === collaboration.attempt.id) {
				const failure = readRuntimeFailure(error);
				await this.options.settleAttempt(
					configuredSession,
					current,
					collaboration.attempt,
					classifyTeamAttemptTerminal({
						hasPublishableMessage: false,
						cancelled,
						...(failure ? { issue: classifyTeamExecutionIssue(failure) } : {}),
					}),
				);
			}
			// A user stop is a normal terminal outcome. The cancellation has already
			// been persisted above (when an attempt was admitted); do not turn it into
			// an IPC rejection that makes the renderer restore the submitted draft.
			if (cancelled) return this.options.sessionState.get(configuredSession.id) ?? configuredSession;
			throw error;
		}
	}

	private async beginMemberAttempt(input: {
		readonly session: TeamSessionDocument;
		readonly memberId: string;
		readonly requestId: string;
		readonly sourceTurnId: string;
		readonly createdByParticipantId: string;
		readonly objective: string;
		readonly attachments?: readonly PromptAttachmentRef[];
		readonly mode: TeamMemberTurnAttemptMode;
		readonly kind?: "task" | "question";
		readonly notificationIds?: readonly string[];
	}): Promise<{ workItem: TeamWorkItem; attempt: TeamMemberTurnAttempt }> {
		const result = await this.options.collaborationStore.begin(input);
		const observations = this.options.observations(input.session);
		if (result.created) {
			observations?.publishWorkItem({
				teamId: input.session.teamId,
				coordinationConversationId: input.session.coordinationRuntime?.sessionId ?? input.session.id,
				participantId: input.memberId,
				workItemId: result.workItem.id,
				...(result.workItem.originToolCallId ? { toolCallId: result.workItem.originToolCallId } : {}),
				requestTurnId: input.requestId,
				phase: "created",
			});
		}
		observations?.publishMemberRuntime({
			teamId: input.session.teamId,
			coordinationConversationId: input.session.coordinationRuntime?.sessionId ?? input.session.id,
			participantId: input.memberId,
			workItemId: result.workItem.id,
			attemptId: result.attempt.id,
			...(result.workItem.originToolCallId ? { toolCallId: result.workItem.originToolCallId } : {}),
			requestTurnId: input.requestId,
			sourceTurnId: input.sourceTurnId,
			phase: input.mode === "initial" ? "start" : input.mode === "recovery" ? "recover" : input.mode,
			attempt: result.attempt.attempt,
		});
		return result;
	}

	private async executeMemberAttempt(
		session: TeamSessionDocument,
		input: TeamMemberTurnRequest,
		collaboration: { readonly workItem: TeamWorkItem; readonly attempt: TeamMemberTurnAttempt },
	): Promise<TeamSessionDocument> {
		const {
			memberId,
			promptText,
			requestId,
			sourceTurnId,
			signal,
			attachments,
			mode = "initial",
			streamingBehavior,
		} = input;
		let configuredSession = session;
		let preparedContext: Awaited<ReturnType<TeamSharedContextService["prepareMemberContext"]>>;
		try {
			preparedContext = await this.options.sharedContextService.prepareMemberContext({
				session: configuredSession,
				memberId,
				requestId,
				workItemId: collaboration.workItem.id,
				attemptId: collaboration.attempt.id,
				...(input.directContextEntryIds?.length ? { directContextEntryIds: input.directContextEntryIds } : {}),
				...(signal ? { signal } : {}),
			});
		} catch (error) {
			const failure = readRuntimeFailure(error);
			const cancelled = this.isCancelled(configuredSession, collaboration.workItem.id, signal);
			const terminal = classifyTeamAttemptTerminal({
				hasPublishableMessage: false,
				cancelled,
				...(failure ? { issue: classifyTeamExecutionIssue(failure) } : {}),
			});
			await this.options.settleAttempt(configuredSession, collaboration.workItem, collaboration.attempt, terminal);
			throw error;
		}
		configuredSession = preparedContext.session;
		const runtimeState = configuredSession.memberRuntime[memberId];
		if (!runtimeState) throw new Error(`Team member runtime not found: ${memberId}`);
		log.info("team member turn started", {
			teamSessionId: configuredSession.id,
			memberId,
			requestId,
			sharedContextCount: preparedContext.count,
		});
		if (signal?.aborted) {
			await this.options.settleAttempt(
				configuredSession,
				collaboration.workItem,
				collaboration.attempt,
				classifyTeamAttemptTerminal({ hasPublishableMessage: false, cancelled: true }),
			);
			return this.options.sessionState.get(configuredSession.id) ?? configuredSession;
		}
		const previousEntryIds = new Set(
			this.options
				.runtime()
				.readSessionDocument(runtimeState.sessionId)
				.entries.map((entry) => entry.id),
		);
		const abortTarget = () => {
			void this.options.runtime().abort(runtimeState.sessionId);
		};
		const startedAt = Date.now();
		const deliveryId = this.options.collaborationStore
			.read(configuredSession)
			.deliveries.find((delivery) => delivery.workItemId === collaboration.workItem.id)?.id;
		const resultMessageId = teamMemberResultMessageId(configuredSession.id, requestId, memberId, sourceTurnId);
		const activeTurn = {
			teamSessionId: configuredSession.id,
			memberId,
			requestId,
			turnId: sourceTurnId,
			messageId: resultMessageId,
			author: {
				kind: "agent" as const,
				id: memberId,
				...(runtimeState.agentProfileId ? { agentId: runtimeState.agentProfileId } : {}),
			},
			workItemId: collaboration.workItem.id,
			attemptId: collaboration.attempt.id,
			...(deliveryId ? { deliveryId } : {}),
			startedAt,
			seq: 0,
			text: "",
			rawAssistantStream: false,
			toolExecutionEvents: [],
		};
		this.options.eventHub.beginTurn(runtimeState.sessionId, activeTurn);
		let promptFailure: ReturnType<typeof readRuntimeFailure>;
		let promptFailureMessage: string | undefined;
		const runtimeOperation = mode === "initial" ? "prompt" : mode;
		const runtimeCallStartedAt = Date.now();
		log.info("team member runtime call started", {
			teamSessionId: configuredSession.id,
			memberId,
			requestId,
			runtimeSessionId: runtimeState.sessionId,
			operation: runtimeOperation,
			mode,
		});
		try {
			this.options.eventHub.attach(configuredSession);
			if (input.modelKey || input.reasoning) {
				await this.options.runtime().updateSettings(runtimeState.sessionId, {
					...(input.modelKey ? { modelKey: input.modelKey } : {}),
					...(input.reasoning ? { thinkingLevel: input.reasoning } : {}),
				});
			}
			let promptOutcome: Awaited<ReturnType<RuntimeHost["prompt"]>> | undefined;
			const continuationContext = undeliveredTeamNotifications(
				input.continuationContext ??
					new TeamNotificationJournal(this.options.collaborationStore).contexts(
						configuredSession,
						collaboration.workItem.notificationIds ?? [],
					),
				this.options.runtime().readSessionDocument(runtimeState.sessionId),
			);
			if (continuationContext.length) {
				signal?.addEventListener("abort", abortTarget, { once: true });
				// Resolves after the Runtime continuation turn that consumes these records.
				await this.options
					.runtime()
					.deliverSessionContext(
						runtimeState.sessionId,
						[...preparedContext.contextRecords, ...continuationContext],
						"triggerTurn",
					);
			} else if (mode === "continue" || mode === "recovery") {
				signal?.addEventListener("abort", abortTarget, { once: true });
				if (preparedContext.contextRecords.length > 0) {
					await this.options
						.runtime()
						.deliverSessionContext(runtimeState.sessionId, preparedContext.contextRecords, "triggerTurn");
				} else {
					await this.options.runtime().continue(runtimeState.sessionId);
				}
			} else if (mode === "retry") {
				signal?.addEventListener("abort", abortTarget, { once: true });
				await this.options.runtime().retry(runtimeState.sessionId);
			} else {
				const runtime = this.options.runtime();
				const request = {
					text: promptText,
					...(preparedContext.contextRecords.length ? { context: preparedContext.contextRecords } : {}),
					...(attachments?.length ? { attachments: [...attachments] } : {}),
					...(input.modelKey ? { modelKey: input.modelKey } : {}),
					...(input.reasoning ? { reasoning: input.reasoning } : {}),
					...(streamingBehavior ? { streamingBehavior } : {}),
				};
				promptOutcome = await runtime.promptWhenAvailable(runtimeState.sessionId, request, signal);
			}
			if (signal?.aborted) throw new Error("Team member turn was cancelled");
			if (promptOutcome?.status === "failed") {
				promptFailure = readRuntimeFailure(promptOutcome.error);
				promptFailureMessage = promptOutcome.error?.message ?? "Team member turn failed";
			}
			promptFailure ??= findTeamAttemptFailure(
				this.options.runtime().getFullHistory(runtimeState.sessionId),
				previousEntryIds,
			);
			promptFailureMessage ??= promptFailure?.message;
			log.info("team member runtime call returned", {
				teamSessionId: configuredSession.id,
				memberId,
				requestId,
				runtimeSessionId: runtimeState.sessionId,
				operation: runtimeOperation,
				status: promptOutcome?.status ?? "completed-awaiting-events",
				elapsedMs: Date.now() - runtimeCallStartedAt,
				failureCode: promptFailure?.code,
			});
		} catch (error) {
			const failure =
				readRuntimeFailure(error) ??
				(isAIError(error) ? runtimeFailureFromError(error) : undefined) ??
				promptFailure;
			const cancelled = this.isCancelled(configuredSession, collaboration.workItem.id, signal);
			const terminal = classifyTeamAttemptTerminal({
				hasPublishableMessage: false,
				cancelled,
				...(failure ? { issue: classifyTeamExecutionIssue(failure) } : {}),
			});
			const recoverable =
				terminal.state === "waiting-retry" ||
				terminal.state === "interrupted" ||
				terminal.state === "awaiting-resource";
			// Runtime Core persists the aborted or failed assistant message (including
			// tool calls) in the member conversation. Publish that durable partial before
			// discarding the live stream, otherwise stopping or a provider failure makes
			// the Team timeline irreversibly lose what the leader/member already produced.
			const partialMessageId = await this.tryPublishPartialAttempt(
				configuredSession,
				collaboration,
				runtimeState.sessionId,
				previousEntryIds,
				sourceTurnId,
				cancelled || !recoverable ? "terminal-partial" : undefined,
			);
			const settled = await this.options.settleAttempt(
				configuredSession,
				collaboration.workItem,
				collaboration.attempt,
				terminal,
				cancelled ? partialMessageId : undefined,
			);
			if (partialMessageId && (cancelled || !recoverable)) {
				await this.publishTerminalPartial({
					session: configuredSession,
					item: collaboration.workItem,
					attempt: { ...collaboration.attempt, ...terminal },
					runtimeSessionId: runtimeState.sessionId,
					sourceTurnId,
					previousEntryIds,
				});
			}
			this.options.eventHub.discard(
				activeTurn,
				cancelled ? "aborted" : recoverable && settled.state === "waiting" ? "waiting" : "failed",
				cancelled || (recoverable && settled.state === "waiting") ? undefined : errorMessage(error),
			);
			if (cancelled) {
				log.info("team member runtime call cancelled", {
					teamSessionId: configuredSession.id,
					memberId,
					requestId,
					runtimeSessionId: runtimeState.sessionId,
					operation: runtimeOperation,
					terminalState: terminal.state,
					elapsedMs: Date.now() - runtimeCallStartedAt,
				});
				return this.options.sessionState.get(configuredSession.id) ?? configuredSession;
			}
			log.error("team member runtime call failed", {
				teamSessionId: configuredSession.id,
				memberId,
				requestId,
				runtimeSessionId: runtimeState.sessionId,
				operation: runtimeOperation,
				terminalState: terminal.state,
				failureCode: failure?.code,
				elapsedMs: Date.now() - runtimeCallStartedAt,
				error: errorMessage(error),
			});
			if (recoverable && !promptFailure)
				return this.options.sessionState.get(configuredSession.id) ?? configuredSession;
			throw error;
		} finally {
			this.options.eventHub.endTurn(runtimeState.sessionId);
			signal?.removeEventListener("abort", abortTarget);
		}
		if (promptFailureMessage) {
			const terminal = classifyTeamAttemptTerminal({
				hasPublishableMessage: false,
				cancelled: this.isCancelled(configuredSession, collaboration.workItem.id, signal),
				...(promptFailure ? { issue: classifyTeamExecutionIssue(promptFailure) } : {}),
			});
			const waitingRetry = terminal.state === "waiting-retry";
			const partialMessageId = await this.tryPublishPartialAttempt(
				configuredSession,
				collaboration,
				runtimeState.sessionId,
				previousEntryIds,
				sourceTurnId,
				waitingRetry ? undefined : "terminal-partial",
			);
			if (this.isCancelled(configuredSession, collaboration.workItem.id, signal)) {
				const terminal = classifyTeamAttemptTerminal({ hasPublishableMessage: false, cancelled: true });
				await this.options.settleAttempt(
					configuredSession,
					collaboration.workItem,
					collaboration.attempt,
					terminal,
				);
				if (partialMessageId) {
					await this.publishTerminalPartial({
						session: configuredSession,
						item: collaboration.workItem,
						attempt: { ...collaboration.attempt, ...terminal },
						runtimeSessionId: runtimeState.sessionId,
						sourceTurnId,
						previousEntryIds,
					});
				}
				this.options.eventHub.discard(activeTurn, "aborted");
				return this.options.sessionState.get(configuredSession.id) ?? configuredSession;
			}
			const settled = await this.options.settleAttempt(
				configuredSession,
				collaboration.workItem,
				collaboration.attempt,
				terminal,
			);
			if (partialMessageId && !waitingRetry) {
				await this.publishTerminalPartial({
					session: configuredSession,
					item: collaboration.workItem,
					attempt: { ...collaboration.attempt, ...terminal },
					runtimeSessionId: runtimeState.sessionId,
					sourceTurnId,
					previousEntryIds,
				});
			}
			this.options.eventHub.discard(
				activeTurn,
				waitingRetry && settled.state === "waiting" ? "waiting" : "failed",
				waitingRetry && settled.state === "waiting" ? undefined : promptFailureMessage,
			);
			log[waitingRetry ? "warn" : "error"]("team member runtime returned failed outcome", {
				teamSessionId: configuredSession.id,
				memberId,
				requestId,
				runtimeSessionId: runtimeState.sessionId,
				terminalState: terminal.state,
				failureCode: promptFailure?.code,
				elapsedMs: Date.now() - runtimeCallStartedAt,
				error: promptFailureMessage,
			});
			if (waitingRetry) return this.options.sessionState.get(configuredSession.id) ?? configuredSession;
			throw new Error(promptFailureMessage);
		}

		const attemptHistory = this.options.runtime().getFullHistory(runtimeState.sessionId);
		const attemptResult = findTeamAttemptResult(attemptHistory, previousEntryIds);
		const assistant = attemptResult?.message;
		if (!attemptResult || !assistant || !isTeamAttemptFinalResult(assistant)) {
			// A turn can delegate work and then lose its next model call. The work item
			// stays waiting, but the delegation it already made must remain visible.
			await this.tryPublishPartialAttempt(
				configuredSession,
				collaboration,
				runtimeState.sessionId,
				previousEntryIds,
				sourceTurnId,
			);
			const terminal = classifyTeamAttemptTerminal({ hasPublishableMessage: false, cancelled: false });
			await this.options.settleAttempt(configuredSession, collaboration.workItem, collaboration.attempt, terminal);
			if (assistant?.stopReason === "error" || assistant?.stopReason === "aborted") {
				await this.publishTerminalPartial({
					session: configuredSession,
					item: collaboration.workItem,
					attempt: { ...collaboration.attempt, ...terminal },
					runtimeSessionId: runtimeState.sessionId,
					sourceTurnId,
					previousEntryIds,
				});
			}
			this.options.eventHub.discard(activeTurn, "waiting");
			return this.options.sessionState.get(configuredSession.id) ?? configuredSession;
		}
		await this.options.publicationWorkflow.publishAttempt({
			session: configuredSession,
			item: collaboration.workItem,
			attempt: collaboration.attempt,
			sourceTurnId,
			sourceMessageEntryId: attemptResult.entryId,
			assistant: publicAttemptAssistantMessage(attemptHistory, previousEntryIds, assistant),
			completeWorkItem: async (messageId) => {
				await this.options.settleAttempt(
					configuredSession,
					collaboration.workItem,
					collaboration.attempt,
					classifyTeamAttemptTerminal({ hasPublishableMessage: true, cancelled: false }),
					messageId,
				);
			},
		});
		const next = await this.options.sessionState.coordinateLoaded(configuredSession.id, async (current) => {
			const updated = markTeamMemberContextDelivered({
				session: current,
				memberId,
				deliveredEventIds: [...preparedContext.eventIds, ...(input.directContextEntryIds ?? [])],
				timestamp: Date.now(),
			});
			await this.options.sessionState.persist(updated);
			this.options.publishSessionUpdated(updated);
			return updated;
		});
		this.options.eventHub.discard(activeTurn, "completed");
		log.info("team member turn completed", {
			teamSessionId: next.id,
			memberId,
			requestId,
			sharedContextCount: preparedContext.count,
		});
		return next;
	}

	/** Publishes whatever public content an unfinished attempt left in its member conversation. */
	private async publishPartialAttempt(
		session: TeamSessionDocument,
		collaboration: { readonly workItem: TeamWorkItem; readonly attempt: TeamMemberTurnAttempt },
		runtimeSessionId: string,
		previousEntryIds: ReadonlySet<string>,
		sourceTurnId: string,
		purpose?: "terminal-partial",
	): Promise<string | undefined> {
		const history = this.options.runtime().getFullHistory(runtimeSessionId);
		const result = findTeamAttemptResult(history, previousEntryIds);
		if (!result) return undefined;
		const assistant = publicAttemptAssistantMessage(history, previousEntryIds, result.message);
		if (!hasPublicAssistantContent(assistant)) return undefined;
		return this.options.publicationWorkflow.publishPartialAttempt({
			session,
			item: collaboration.workItem,
			attempt: collaboration.attempt,
			sourceTurnId,
			sourceMessageEntryId: result.entryId,
			assistant,
			...(purpose ? { purpose } : {}),
		});
	}

	private async tryPublishPartialAttempt(
		session: TeamSessionDocument,
		collaboration: { readonly workItem: TeamWorkItem; readonly attempt: TeamMemberTurnAttempt },
		runtimeSessionId: string,
		previousEntryIds: ReadonlySet<string>,
		sourceTurnId: string,
		purpose?: "terminal-partial",
	): Promise<string | undefined> {
		try {
			return await this.publishPartialAttempt(
				session,
				collaboration,
				runtimeSessionId,
				previousEntryIds,
				sourceTurnId,
				purpose,
			);
		} catch (error) {
			log.error("team partial publication failed", {
				teamSessionId: session.id,
				memberId: collaboration.workItem.assignedToParticipantId,
				workItemId: collaboration.workItem.id,
				attemptId: collaboration.attempt.id,
				error: errorMessage(error),
			});
			return undefined;
		}
	}

	private isCancelled(session: TeamSessionDocument, workItemId: string, signal?: AbortSignal): boolean {
		if (signal?.aborted === true) return true;
		return this.options.collaborationStore
			.read(session)
			.workItems.some((item) => item.id === workItemId && item.state === "cancelled");
	}

	private async publishTerminalPartial(input: {
		readonly session: TeamSessionDocument;
		readonly item: TeamWorkItem;
		readonly attempt: TeamMemberTurnAttempt;
		readonly runtimeSessionId: string;
		readonly sourceTurnId: string;
		readonly previousEntryIds: ReadonlySet<string>;
	}): Promise<void> {
		try {
			const history = this.options.runtime().getFullHistory(input.runtimeSessionId);
			const result = findTeamAttemptResult(history, input.previousEntryIds);
			if (!result) return;
			const assistant = publicAttemptAssistantMessage(history, input.previousEntryIds, result.message);
			if (!hasPublicAssistantContent(assistant)) return;
			await this.options.publicationWorkflow.publishTerminalAttempt({
				session: input.session,
				item: input.item,
				attempt: input.attempt,
				sourceTurnId: input.sourceTurnId,
				sourceMessageEntryId: result.entryId,
				assistant,
			});
		} catch (error) {
			log.error("team terminal partial publication failed", {
				teamSessionId: input.session.id,
				memberId: input.item.assignedToParticipantId,
				workItemId: input.item.id,
				attemptId: input.attempt.id,
				error: errorMessage(error),
			});
		}
	}
}

function publicAttemptAssistantMessage(
	history: readonly HistoryEntry[],
	previousEntryIds: ReadonlySet<string>,
	terminal: AssistantMessage,
): AssistantMessage {
	const content = history.flatMap((entry) => {
		if (
			entry.type !== "message" ||
			!entry.entryId ||
			previousEntryIds.has(entry.entryId) ||
			entry.message.role !== "assistant"
		)
			return [];
		return publicAssistantMessage(entry.message).content;
	});
	return { ...publicAssistantMessage(terminal), content };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function hasPublicAssistantContent(message: AssistantMessage): boolean {
	return message.content.some((part) => part.type === "text" || part.type === "toolCall");
}
