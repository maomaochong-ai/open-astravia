import {
	type AgentTeamDocument,
	type AgentTeamExtensionRegistry,
	buildTeamRosterSnapshot,
	type classifyTeamAttemptTerminal,
	isDefaultTeamTaskActionAllowed,
	resolveMemberByHandle,
	type SendTeamMessageInput,
	type TeamExternalConditionChange,
	type TeamMemberTurnAttempt,
	type TeamMemberTurnAttemptMode,
	type TeamMessageControlPort,
	type TeamMessageRoutingRecord,
	type TeamObservationPublisher,
	type TeamSessionDocument,
	type TeamTaskControlPort,
	type TeamWorkItem,
	teamUserMessageId,
} from "@vetta/agent-team";
import type { PromptAttachmentRef, RuntimeHost } from "@vetta/runtime-core";
import { getAppLogger } from "../logger.js";
import type { TeamCollaborationState, TeamCollaborationStore } from "./team-collaboration-store.js";
import type { TeamMemberAttemptRunner } from "./team-member-attempt-runner.js";
import { TeamMemberScheduler } from "./team-member-scheduler.js";
import type { TeamMemberTurnRequest } from "./team-member-turn-request.js";
import { TeamMessageControlService } from "./team-message-control-service.js";
import type { TeamSessionEventHub } from "./team-session-event-hub.js";
import type { TeamSessionStateRepository } from "./team-session-state-repository.js";
import { TeamTaskControlService } from "./team-task-control-service.js";
import { deliverTeamTaskCompletionNotification } from "./team-task-notification.js";

const log = getAppLogger("agent-team-turns");

export interface TeamTurnCoordinatorOptions {
	readonly runtime: () => RuntimeHost;
	readonly extensions: AgentTeamExtensionRegistry;
	readonly collaborationStore: TeamCollaborationStore;
	readonly sessionState: TeamSessionStateRepository;
	readonly eventHub: TeamSessionEventHub;
	readonly readSession: (sessionId: string) => Promise<TeamSessionDocument>;
	readonly readDocument: () => Promise<AgentTeamDocument>;
	readonly observations: (session: TeamSessionDocument) => TeamObservationPublisher | undefined;
	readonly publishSessionUpdated: (session: TeamSessionDocument) => void;
}

/** Owns Team request admission, member scheduling, cancellation, retries, and attempt settlement. */
export class TeamTurnCoordinator {
	private readonly memberScheduler = new TeamMemberScheduler();
	private readonly memberCancellations = new Map<string, Map<string, AbortController>>();
	private readonly activeSends = new Map<string, Set<AbortController>>();
	private readonly taskControl: TeamTaskControlService;
	private readonly messageControl: TeamMessageControlService;
	private memberAttemptRunner: TeamMemberAttemptRunner | undefined;

	constructor(private readonly options: TeamTurnCoordinatorOptions) {
		this.taskControl = new TeamTaskControlService(options.collaborationStore, this.memberScheduler, {
			readSession: options.readSession,
			readConversation: (id) => options.runtime().readSessionDocument(id),
			runMemberTurn: (input) => this.scheduleMemberTurn(input),
			cancelMemberTurn: (sessionId, workItemId) => this.memberCancellations.get(sessionId)?.get(workItemId)?.abort(),
			resolveTarget: (session, handle) => resolveMemberByHandle(this.syntheticTeam(session), handle)?.id,
			authorizeTask: (session, sourceMemberId, targetMemberId, action) => {
				const team = this.syntheticTeam(session);
				const policy = options.extensions.orchestrationPolicies.get(team.orchestrationPolicyId);
				if (!policy) throw new Error(`Unknown team orchestration policy: ${team.orchestrationPolicyId}`);
				return policy.authorizeTask
					? policy.authorizeTask({ team, action, sourceMemberId, targetMemberId }) === true
					: isDefaultTeamTaskActionAllowed({
							leaderMemberId: team.leaderMemberId,
							action,
							sourceMemberId,
							targetMemberId,
						});
			},
			onAdmitted: (session, item, created) => this.recordTaskAdmission(session.id, item, created),
			onSettled: (session, item) => this.messageControl.reconcileWorkItem(session, item),
			onRequeued: (session, item, trigger) => this.publishTaskRecovery(session, item, trigger),
		});
		this.messageControl = new TeamMessageControlService(options.collaborationStore, {
			readSession: options.readSession,
			resolveTarget: (session, handle) => resolveMemberByHandle(this.syntheticTeam(session), handle)?.id,
			appendMessage: (sessionId, message) => options.runtime().appendConversationMessage(sessionId, message),
			appendMetadata: (sessionId, customType, data) =>
				options.runtime().appendSessionMetadataEntry(sessionId, customType, data),
			startWorkItem: (session, item) => this.taskControl.startAdmitted(session, item, "initial"),
			onDelivery: (session, delivery) => {
				options.publishSessionUpdated(session);
				options.observations(session)?.publishDelivery({
					teamId: session.teamId,
					coordinationConversationId: session.coordinationRuntime?.sessionId ?? session.id,
					participantId: delivery.toParticipantId,
					deliveryId: delivery.id,
					...(delivery.workItemId ? { workItemId: delivery.workItemId } : {}),
					requestTurnId: delivery.messageId,
					...(delivery.sourceTurnId ? { sourceTurnId: delivery.sourceTurnId } : {}),
					...(delivery.toolCallId ? { toolCallId: delivery.toolCallId } : {}),
					phase: delivery.state,
					intent: delivery.intent,
					fromParticipantId: delivery.fromParticipantId,
					toParticipantId: delivery.toParticipantId,
				});
			},
		});
	}

	setAttemptRunner(runner: TeamMemberAttemptRunner): void {
		this.memberAttemptRunner = runner;
	}

	taskControls(sessionId: string): TeamTaskControlPort {
		return this.taskControl.forSession(sessionId);
	}

	messageControls(sessionId: string): TeamMessageControlPort {
		return this.messageControl.forSession(sessionId);
	}

	async recoverSession(session: TeamSessionDocument): Promise<void> {
		await this.messageControl.recoverSession(session);
		await this.taskControl.recoverSession(session);
	}

	hasPending(sessionId: string): boolean {
		return (
			this.activeSends.has(sessionId) ||
			this.memberScheduler.hasPending(sessionId) ||
			this.taskControl.hasPending(sessionId)
		);
	}

	private getAttemptRunner(): TeamMemberAttemptRunner {
		if (!this.memberAttemptRunner) throw new Error("Team member attempt runner is unavailable");
		return this.memberAttemptRunner;
	}
	async send(sessionId: string, input: SendTeamMessageInput): Promise<TeamSessionDocument> {
		const startedAt = Date.now();
		log.info("team message send started", {
			teamSessionId: sessionId,
			requestId: input.requestId,
			textLength: input.text.length,
			targetMemberCount: input.targetMemberIds?.length ?? 0,
			attachmentCount: input.attachments?.length ?? 0,
			modelKey: input.modelKey,
			reasoning: input.reasoning,
		});
		let controller: AbortController | undefined;
		try {
			await this.options.readSession(sessionId);
			controller = this.trackRequest(sessionId);
			const result = await this.sendInternal(sessionId, input, controller.signal);
			log.info("team message send completed", {
				teamSessionId: sessionId,
				requestId: input.requestId,
				elapsedMs: Date.now() - startedAt,
			});
			return result;
		} catch (error) {
			log.error("team message failed", {
				teamSessionId: sessionId,
				requestId: input.requestId,
				elapsedMs: Date.now() - startedAt,
				error: errorMessage(error),
			});
			throw error;
		} finally {
			if (controller) this.untrackRequest(sessionId, controller);
		}
	}

	async abort(sessionId: string): Promise<void> {
		for (const controller of this.activeSends.get(sessionId) ?? []) controller.abort();
		this.taskControl.abortTeam(sessionId);
	}

	private trackRequest(sessionId: string): AbortController {
		const controller = new AbortController();
		const requests = this.activeSends.get(sessionId) ?? new Set<AbortController>();
		requests.add(controller);
		this.activeSends.set(sessionId, requests);
		return controller;
	}

	private untrackRequest(sessionId: string, controller: AbortController): void {
		const requests = this.activeSends.get(sessionId);
		requests?.delete(controller);
		if (requests?.size === 0) this.activeSends.delete(sessionId);
	}

	private async sendInternal(
		sessionId: string,
		input: SendTeamMessageInput,
		signal: AbortSignal,
	): Promise<TeamSessionDocument> {
		const admission = await this.options.sessionState.coordinateLoaded(sessionId, async (current) => {
			signal.throwIfAborted();
			const team = this.syntheticTeam(current);
			const orchestration = this.options.extensions.orchestrationPolicies.get(team.orchestrationPolicyId);
			if (!orchestration) throw new Error(`Unknown team orchestration policy: ${team.orchestrationPolicyId}`);
			const targets = orchestration.resolveTargets({ team, requestedMemberIds: input.targetMemberIds });
			this.options.observations(current)?.publishRouting({
				teamId: current.teamId,
				coordinationConversationId: current.coordinationRuntime?.sessionId ?? current.id,
				requestTurnId: input.requestId,
				phase: "resolved",
				targetParticipantIds: targets,
				policyId: team.orchestrationPolicyId,
			});
			const coordinationRuntime = current.coordinationRuntime;
			if (!coordinationRuntime) throw new Error("Team coordination conversation is unavailable");
			const coordinationDocument = this.options.runtime().readSessionDocument(coordinationRuntime.sessionId);
			const userMessageId = teamUserMessageId(current.id, input.requestId);
			const existingUser = coordinationDocument.entries.find((entry) => entry.id === userMessageId);
			const existingRouting = findTeamMessageRouting(coordinationDocument.entries, userMessageId);
			if (
				existingUser &&
				(existingUser.type !== "message" ||
					existingUser.kind !== "user" ||
					existingUser.turnId !== input.requestId ||
					userMessageContent(existingUser.message.content) !== input.text ||
					!sameAttachments(existingUser.attachments ?? [], input.attachments ?? []))
			) {
				throw new Error(`Request id already used with different content: ${input.requestId}`);
			}
			if (existingRouting && !sameMemberIds(existingRouting.addressedParticipantIds ?? [], targets)) {
				throw new Error(`Request id already used with different routing: ${input.requestId}`);
			}
			const completed = new Set(
				this.options.collaborationStore
					.read(current)
					.workItems.filter(
						(item) =>
							item.requestTurnId === input.requestId &&
							item.state === "completed" &&
							targets.includes(item.assignedToParticipantId),
					)
					.map((item) => item.assignedToParticipantId),
			);
			if (existingUser && targets.every((memberId) => completed.has(memberId))) {
				return { session: current, remaining: [] };
			}

			const timestamp =
				existingUser?.type === "message" && existingUser.kind === "user"
					? existingUser.message.timestamp
					: Date.now();
			await this.options.runtime().appendConversationMessage(coordinationRuntime.sessionId, {
				kind: "user",
				id: userMessageId,
				turnId: input.requestId,
				timestamp,
				author: { kind: "user", id: "local-user" },
				message: { role: "user", content: input.text, timestamp },
				...(input.attachments?.length ? { attachments: [...input.attachments] } : {}),
			});
			if (!existingRouting) {
				const routing: TeamMessageRoutingRecord = {
					customType: "agent-team.message-routing.v1",
					messageEntryId: userMessageId,
					addressedParticipantIds: [...targets],
					requestId: input.requestId,
				};
				await this.appendCoordinationRecord(current, routing.customType, routing);
			}
			this.options.publishSessionUpdated(current);

			return { session: current, remaining: targets.filter((memberId) => !completed.has(memberId)) };
		});
		log.info("team message admitted", {
			teamSessionId: sessionId,
			requestId: input.requestId,
			remainingMemberCount: admission.remaining.length,
			remainingMemberIds: admission.remaining,
		});
		// Join every member before releasing this request's cancellation scope. A failing
		// sibling does not abort independent work or overwrite an already published result.
		const results = await Promise.allSettled(
			admission.remaining.map((memberId) =>
				this.scheduleMemberTurn({
					teamSessionId: sessionId,
					memberId,
					promptText: input.text,
					requestId: input.requestId,
					sourceTurnId: `${input.requestId}:${memberId}`,
					createdByParticipantId: "local-user",
					signal,
					attachments: input.attachments,
					modelKey: input.modelKey,
					reasoning: input.reasoning,
				}),
			),
		);
		log.info("team member turns settled", {
			teamSessionId: sessionId,
			requestId: input.requestId,
			targetMemberCount: admission.remaining.length,
			fulfilledCount: results.filter((result) => result.status === "fulfilled").length,
			rejectedCount: results.filter((result) => result.status === "rejected").length,
		});
		const rejected = results.find((result) => result.status === "rejected");
		if (rejected?.status === "rejected") throw rejected.reason;
		return this.options.sessionState.get(sessionId) ?? admission.session;
	}

	async readCollaborationState(sessionId: string): Promise<TeamCollaborationState> {
		const session = await this.options.readSession(sessionId);
		return this.options.collaborationStore.read(session);
	}

	/** Wakes only loaded work items whose persisted external issue matches this host fact. */
	async notifyExternalConditionChanged(change: TeamExternalConditionChange): Promise<number> {
		let resumed = 0;
		for (const session of this.options.sessionState.values()) {
			resumed += await this.taskControl.notifyExternalConditionChanged(session, change);
		}
		return resumed;
	}

	async recoverWorkItem(
		sessionId: string,
		workItemId: string,
		mode: Extract<TeamMemberTurnAttemptMode, "continue" | "retry" | "recovery">,
	): Promise<TeamSessionDocument> {
		const session = await this.options.readSession(sessionId);
		const state = await this.readCollaborationState(sessionId);
		const workItem = state.workItems.find((item) => item.id === workItemId);
		if (!workItem) throw new Error(`Team work item not found: ${workItemId}`);
		if (workItem.state !== "waiting" && workItem.state !== "attention-required") {
			throw new Error(`Team work item cannot be recovered from state: ${workItem.state}`);
		}
		const attemptNumber = state.attempts.filter((attempt) => attempt.workItemId === workItemId).length + 1;
		const controller = this.trackRequest(sessionId);
		try {
			return await this.scheduleMemberTurn({
				teamSessionId: session.id,
				memberId: workItem.assignedToParticipantId,
				promptText: workItem.objective,
				requestId: workItem.requestTurnId,
				sourceTurnId: `${workItem.requestTurnId}:${workItem.assignedToParticipantId}:recovery:${attemptNumber}`,
				createdByParticipantId: workItem.createdByParticipantId,
				signal: controller.signal,
				attachments: workItem.artifactRefs,
				mode,
				expectedWorkItemRevision: workItem.revision,
			});
		} finally {
			this.untrackRequest(sessionId, controller);
		}
	}

	private async appendCoordinationRecord(
		session: TeamSessionDocument,
		customType: string,
		data: unknown,
	): Promise<void> {
		await this.options.collaborationStore.append(session, customType, data);
	}

	async settleMemberAttempt(
		session: TeamSessionDocument,
		workItem: TeamWorkItem,
		attempt: TeamMemberTurnAttempt,
		terminal: ReturnType<typeof classifyTeamAttemptTerminal>,
		resultMessageId?: string,
	): Promise<TeamWorkItem> {
		const nextWorkItem = await this.options.collaborationStore.settle(
			session,
			workItem,
			attempt,
			terminal,
			resultMessageId,
		);
		this.options.observations(session)?.publishWorkItem({
			teamId: session.teamId,
			coordinationConversationId: session.coordinationRuntime?.sessionId ?? session.id,
			participantId: workItem.assignedToParticipantId,
			workItemId: workItem.id,
			attemptId: attempt.id,
			...(workItem.originToolCallId ? { toolCallId: workItem.originToolCallId } : {}),
			requestTurnId: workItem.requestTurnId,
			...(resultMessageId ? { resultMessageId } : {}),
			phase: nextWorkItem.state,
			...(terminal.issue ? { issueCategory: terminal.issue.category } : {}),
		});
		this.options.publishSessionUpdated(session);
		if (nextWorkItem.state === "completed" && resultMessageId) {
			await this.notifyTaskInitiator(session, nextWorkItem, resultMessageId);
		}
		await this.taskControl.onWorkItemSettled(session, nextWorkItem);
		return nextWorkItem;
	}

	private async notifyTaskInitiator(
		session: TeamSessionDocument,
		workItem: TeamWorkItem,
		resultMessageId: string,
	): Promise<void> {
		const initiator = session.memberRuntime[workItem.createdByParticipantId];
		if (!initiator) return;
		const coordination = session.coordinationRuntime;
		if (!coordination) return;
		const resultEntry = this.options
			.runtime()
			.readSessionDocument(coordination.sessionId)
			.entries.find((entry) => entry.type === "message" && entry.id === resultMessageId);
		const resultText = resultEntry?.type === "message" ? extractMessageText(resultEntry.message) : "";
		try {
			await deliverTeamTaskCompletionNotification(this.options.runtime(), initiator.sessionId, {
				teamTaskId: workItem.id,
				assignedToParticipantId: workItem.assignedToParticipantId,
				requestTurnId: workItem.requestTurnId,
				resultMessageId,
				resultText,
			});
		} catch (error) {
			// A closed or recovering initiator can still observe the durable result later.
			log.warn("Team task completion notification could not wake initiator", {
				teamSessionId: session.id,
				teamTaskId: workItem.id,
				initiatorParticipantId: workItem.createdByParticipantId,
				errorName: error instanceof Error ? error.name : "UnknownError",
			});
		}
	}

	private publishTaskRecovery(
		session: TeamSessionDocument,
		item: TeamWorkItem,
		trigger: "manual" | "automatic" | "external-change",
	): void {
		this.options.observations(session)?.publishWorkItem({
			teamId: session.teamId,
			coordinationConversationId: session.coordinationRuntime?.sessionId ?? session.id,
			participantId: item.assignedToParticipantId,
			workItemId: item.id,
			...(item.currentAttemptId ? { attemptId: item.currentAttemptId } : {}),
			...(item.originToolCallId ? { toolCallId: item.originToolCallId } : {}),
			requestTurnId: item.requestTurnId,
			phase: "recovered",
			recoveryTrigger: trigger,
			...(item.lastIssue ? { issueCategory: item.lastIssue.category } : {}),
		});
	}

	private async scheduleMemberTurn(input: TeamMemberTurnRequest): Promise<TeamSessionDocument> {
		const session = await this.options.readSession(input.teamSessionId);
		const modelKey = input.modelKey ?? session.modelSettings?.modelKey;
		const reasoning =
			input.reasoning ?? (input.modelKey === undefined ? session.modelSettings?.reasoning : undefined);
		const resolvedInput: TeamMemberTurnRequest = {
			...input,
			...(modelKey ? { modelKey } : {}),
			...(reasoning ? { reasoning } : {}),
		};
		const admission = await this.options.collaborationStore.enqueue({
			session,
			memberId: resolvedInput.memberId,
			requestId: resolvedInput.requestId,
			createdByParticipantId: resolvedInput.createdByParticipantId,
			objective: resolvedInput.promptText,
			attachments: resolvedInput.attachments,
			kind: resolvedInput.workItemKind,
		});
		if (admission.created) {
			this.options.observations(session)?.publishWorkItem({
				teamId: session.teamId,
				coordinationConversationId: session.coordinationRuntime?.sessionId ?? session.id,
				participantId: input.memberId,
				workItemId: admission.workItem.id,
				...(admission.workItem.originToolCallId ? { toolCallId: admission.workItem.originToolCallId } : {}),
				requestTurnId: input.requestId,
				phase: "created",
			});
		}
		try {
			return await this.memberScheduler.schedule({
				teamSessionId: session.id,
				memberId: input.memberId,
				waitingMemberId: resolvedInput.waitingMemberId,
				signal: resolvedInput.signal,
				run: async () => {
					const latest = this.options.sessionState.get(session.id) ?? session;
					const workItem = this.options.collaborationStore
						.read(latest)
						.workItems.find((item) => item.id === admission.workItem.id);
					// Concurrent retries of the same request join the durable result, not a second model turn.
					if (workItem?.state === "completed") return latest;
					if (
						input.expectedWorkItemRevision !== undefined &&
						workItem?.revision !== input.expectedWorkItemRevision
					) {
						return latest;
					}
					resolvedInput.signal?.throwIfAborted();
					const controller = new AbortController();
					const cancellations = this.memberCancellations.get(session.id) ?? new Map<string, AbortController>();
					cancellations.set(admission.workItem.id, controller);
					this.memberCancellations.set(session.id, cancellations);
					try {
						return await this.runMemberTurn({
							...resolvedInput,
							signal: resolvedInput.signal
								? AbortSignal.any([resolvedInput.signal, controller.signal])
								: controller.signal,
						});
					} finally {
						cancellations.delete(admission.workItem.id);
						if (cancellations.size === 0) this.memberCancellations.delete(session.id);
					}
				},
			});
		} catch (error) {
			const released = await this.options.collaborationStore.releaseQueued(
				session,
				admission.workItem.id,
				resolvedInput.signal?.aborted ? "cancelled" : "waiting",
			);
			if (released) {
				this.options.observations(session)?.publishWorkItem({
					teamId: session.teamId,
					coordinationConversationId: session.coordinationRuntime?.sessionId ?? session.id,
					participantId: input.memberId,
					workItemId: released.id,
					...(released.originToolCallId ? { toolCallId: released.originToolCallId } : {}),
					requestTurnId: input.requestId,
					phase: released.state,
				});
			}
			throw error;
		}
	}

	private runMemberTurn(input: TeamMemberTurnRequest): Promise<TeamSessionDocument> {
		return this.getAttemptRunner().run(input);
	}
	async listMembers(teamSessionId: string, sourceRuntimeSessionId: string) {
		const session = await this.options.readSession(teamSessionId);
		if (!Object.values(session.memberRuntime).some((state) => state.sessionId === sourceRuntimeSessionId)) {
			throw new Error("Source session is not a persistent member of this Agent Team");
		}
		const document = await this.options.readDocument();
		const team = document.teams.find((candidate) => candidate.id === session.teamId);
		if (!team) throw new Error(`Agent team not found: ${session.teamId}`);
		return buildTeamRosterSnapshot(document, team, {
			capabilitiesByParticipantId: Object.fromEntries(
				Object.entries(session.memberRuntime).map(([participantId, state]) => {
					const active = new Set(this.options.runtime().readSessionActiveToolNames(state.sessionId));
					return [
						participantId,
						[...this.options.runtime().readSessionAvailableTools(state.sessionId).values()]
							.filter((tool) => active.has(tool.name))
							.map((tool) => ({
								kind: "tool" as const,
								id: tool.name,
								label: tool.label,
								summary: tool.description,
							})),
					];
				}),
			),
			availabilityByParticipantId: Object.fromEntries(
				Object.entries(session.memberRuntime).map(([participantId, state]) => [
					participantId,
					this.options.eventHub.isTurnActive(state.sessionId) ? "running" : "idle",
				]),
			),
		});
	}

	private async recordTaskAdmission(sessionId: string, item: TeamWorkItem, created: boolean): Promise<void> {
		await this.options.sessionState.coordinateLoaded(sessionId, async (session) => {
			this.options.publishSessionUpdated(session);
			if (created)
				this.options.observations(session)?.publishWorkItem({
					teamId: session.teamId,
					coordinationConversationId: session.coordinationRuntime?.sessionId ?? session.id,
					participantId: item.assignedToParticipantId,
					workItemId: item.id,
					...(item.originToolCallId ? { toolCallId: item.originToolCallId } : {}),
					requestTurnId: item.requestTurnId,
					phase: "created",
				});
		});
	}

	private syntheticTeam(session: TeamSessionDocument) {
		const activeMemberIds = new Set(session.activeMemberIds ?? Object.keys(session.memberRuntime));
		return {
			id: session.teamId,
			revision: 1,
			name: session.name,
			description: "",
			leaderMemberId: session.leaderMemberId,
			members: Object.entries(session.memberHandles)
				.filter(([id]) => activeMemberIds.has(id))
				.map(([id, handle]) => ({
					id,
					handle,
					binding: { kind: "reference" as const, agentProfileId: id },
				})),
			orchestrationPolicyId: session.orchestrationPolicyId ?? "leader-delegates-v1",
			contextPolicyId: session.contextPolicyId ?? "public-results-v1",
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
		};
	}
}

function findTeamMessageRouting(
	entries: ReturnType<RuntimeHost["readSessionDocument"]>["entries"],
	messageEntryId: string,
): TeamMessageRoutingRecord | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (
			entry?.type === "custom" &&
			isTeamMessageRoutingRecord(entry.data) &&
			entry.data.messageEntryId === messageEntryId
		) {
			return entry.data;
		}
	}
	return undefined;
}

function isTeamMessageRoutingRecord(value: unknown): value is TeamMessageRoutingRecord {
	return (
		typeof value === "object" &&
		value !== null &&
		"customType" in value &&
		value.customType === "agent-team.message-routing.v1" &&
		"messageEntryId" in value &&
		typeof value.messageEntryId === "string"
	);
}

function userMessageContent(content: string | readonly { readonly type: string; readonly text?: string }[]): string {
	return typeof content === "string"
		? content
		: content
				.filter((part): part is { readonly type: "text"; readonly text: string } => part.type === "text")
				.map((part) => part.text)
				.join("");
}

function sameAttachments(left: readonly PromptAttachmentRef[], right: readonly PromptAttachmentRef[]): boolean {
	if (left.length !== right.length) return false;
	const key = (attachment: PromptAttachmentRef) => `${attachment.kind}\u0000${attachment.path}`;
	return left.map(key).sort().join("\u0001") === right.map(key).sort().join("\u0001");
}

function sameMemberIds(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((id, index) => id === right[index]);
}

function extractMessageText(message: unknown): string {
	if (!isRecord(message)) return "";
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((item) => (isRecord(item) && item.type === "text" && typeof item.text === "string" ? [item.text] : []))
		.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
