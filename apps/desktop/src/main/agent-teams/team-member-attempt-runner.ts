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
import type { AssistantMessage } from "@vetta/ai";
import { type HistoryEntry, type PromptAttachmentRef, type RuntimeHost, readRuntimeFailure } from "@vetta/runtime-core";
import { getAppLogger } from "../logger.js";
import type { TeamCollaborationStore } from "./team-collaboration-store.js";
import { findTeamAttemptResult } from "./team-member-result.js";
import type { TeamMemberTurnRequest } from "./team-member-turn-request.js";
import { publicAssistantMessage } from "./team-public-message.js";
import type { TeamPublicationWorkflow } from "./team-publication-workflow.js";
import type { TeamRuntimeManager } from "./team-runtime-manager.js";
import type { TeamSessionEventHub } from "./team-session-event-hub.js";
import type { TeamSessionStateRepository } from "./team-session-state-repository.js";
import { TeamSharedContextRuntimeDeliveryError, type TeamSharedContextService } from "./team-shared-context-service.js";

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
			if (current?.state === "running" && current.currentAttemptId === collaboration.attempt.id) {
				const failure = readRuntimeFailure(error);
				await this.options.settleAttempt(
					configuredSession,
					current,
					collaboration.attempt,
					classifyTeamAttemptTerminal({
						hasPublishableMessage: false,
						cancelled: input.signal?.aborted ?? false,
						...(failure ? { issue: classifyTeamExecutionIssue(failure) } : {}),
					}),
				);
			}
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
		const { memberId, promptText, requestId, sourceTurnId, signal, attachments, mode = "initial" } = input;
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
			const failureSource = error instanceof TeamSharedContextRuntimeDeliveryError ? error.runtimeCause : error;
			const failure = readRuntimeFailure(failureSource);
			const terminal = classifyTeamAttemptTerminal({
				hasPublishableMessage: false,
				cancelled: signal?.aborted ?? false,
				...(failure ? { issue: classifyTeamExecutionIssue(failure) } : {}),
			});
			await this.options.settleAttempt(configuredSession, collaboration.workItem, collaboration.attempt, terminal);
			const recoverable =
				terminal.state === "waiting-retry" ||
				terminal.state === "interrupted" ||
				terminal.state === "awaiting-resource";
			if (recoverable && error instanceof TeamSharedContextRuntimeDeliveryError) {
				return this.options.sessionState.get(configuredSession.id) ?? configuredSession;
			}
			throw failureSource;
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
			throw new Error("Team member turn was cancelled");
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
		};
		this.options.eventHub.beginTurn(runtimeState.sessionId, activeTurn);
		signal?.addEventListener("abort", abortTarget, { once: true });
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
			if (mode === "continue" || mode === "recovery") {
				await this.options.runtime().continue(runtimeState.sessionId);
			} else if (mode === "retry") {
				await this.options.runtime().retry(runtimeState.sessionId);
			} else {
				promptOutcome = await this.options.runtime().prompt(runtimeState.sessionId, {
					text: promptText,
					...(attachments?.length ? { attachments: [...attachments] } : {}),
					...(input.modelKey ? { modelKey: input.modelKey } : {}),
					...(input.reasoning ? { reasoning: input.reasoning } : {}),
				});
			}
			if (signal?.aborted) throw new Error("Team member turn was cancelled");
			if (promptOutcome?.status === "failed") {
				promptFailure = readRuntimeFailure(promptOutcome.error);
				promptFailureMessage = promptOutcome.error?.message ?? "Team member turn failed";
			}
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
			const failure = readRuntimeFailure(error) ?? promptFailure;
			const terminal = classifyTeamAttemptTerminal({
				hasPublishableMessage: false,
				cancelled: signal?.aborted ?? false,
				...(failure ? { issue: classifyTeamExecutionIssue(failure) } : {}),
			});
			await this.options.settleAttempt(configuredSession, collaboration.workItem, collaboration.attempt, terminal);
			const recoverable =
				terminal.state === "waiting-retry" ||
				terminal.state === "interrupted" ||
				terminal.state === "awaiting-resource";
			this.options.eventHub.discard(
				activeTurn,
				signal?.aborted ? "aborted" : recoverable ? "waiting" : "failed",
				signal?.aborted || recoverable ? undefined : errorMessage(error),
			);
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
				cancelled: false,
				...(promptFailure ? { issue: classifyTeamExecutionIssue(promptFailure) } : {}),
			});
			await this.options.settleAttempt(configuredSession, collaboration.workItem, collaboration.attempt, terminal);
			this.options.eventHub.discard(activeTurn, "failed", promptFailureMessage);
			log.error("team member runtime returned failed outcome", {
				teamSessionId: configuredSession.id,
				memberId,
				requestId,
				runtimeSessionId: runtimeState.sessionId,
				terminalState: terminal.state,
				failureCode: promptFailure?.code,
				elapsedMs: Date.now() - runtimeCallStartedAt,
				error: promptFailureMessage,
			});
			throw new Error(promptFailureMessage);
		}

		const attemptHistory = this.options.runtime().getFullHistory(runtimeState.sessionId);
		const attemptResult = findTeamAttemptResult(attemptHistory, previousEntryIds);
		const assistant = attemptResult?.message;
		const resultText = assistant
			? assistant.content
					.filter((item) => item.type === "text")
					.map((item) => item.text)
					.join("\n")
			: "";
		if (
			!attemptResult ||
			!assistant ||
			resultText.trim().length === 0 ||
			assistant.stopReason === "error" ||
			assistant.stopReason === "aborted"
		) {
			await this.options.settleAttempt(
				configuredSession,
				collaboration.workItem,
				collaboration.attempt,
				classifyTeamAttemptTerminal({ hasPublishableMessage: false, cancelled: false }),
			);
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
