import {
	AGENT_TEAM_PUBLICATION_LIFECYCLE,
	type AgentTeamExtensionRegistry,
	createAgentTeamExtensionRegistry,
	createAgentTeamFixture,
	createLegacyTeamMemberDelegationEvent,
	createLegacyTeamMemberResultEvent,
	createLegacyTeamUserMessageEvent,
	isTeamMessageDelivery,
	isTeamWorkItem,
	type TeamContextProjectionPolicy,
	type TeamMessageDelivery,
	type TeamSessionDocument,
	type TeamWorkItem,
} from "@vetta/agent-team";
import { createAssistantMessage } from "@vetta/ai";
import type { CodingAgentPinnedModelContext } from "@vetta/coding-agent/runtime";
import {
	type ConversationDocument,
	createEmptyConversationDocument,
	type RuntimeHost,
	type RuntimeObservationContext,
	type RuntimeSessionContextDeliveryMode,
} from "@vetta/runtime-core";
import type { ConversationMessageRecord } from "@vetta/runtime-core/conversation";
import type { SessionContextRecord } from "@vetta/runtime-core/kernel";
import { createRuntimeObservationPublisher, type RuntimeObservationRecord } from "@vetta/runtime-core/observation";
import { describe, expect, it, vi } from "vitest";
import type { DesktopCodingAgentSessionConfig } from "../conversations/resolve-session-config.js";
import { AgentTeamSessionService } from "./team-session-service.js";

vi.mock("../conversations/resolve-session-config.js", () => ({
	resolveDesktopSessionConfig: vi.fn(async (config: DesktopCodingAgentSessionConfig) => ({ config })),
}));
vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("../runtime.js", () => ({ getSharedRuntime: vi.fn() }));
vi.mock("../ipc/fs.js", () => ({ readDesktopConfig: vi.fn(async () => ({})) }));

describe("Team member concurrency", () => {
	it("restores policy-specific deltas without rerunning a changed policy after restart", async () => {
		let text = "admitted";
		const project = vi.fn<TeamContextProjectionPolicy["project"]>(({ session, targetMemberId }) => [
			{
				eventId: `delta-${targetMemberId}`,
				type: "agent-team.user-message.v1",
				text: `${text}:${targetMemberId}`,
				timestamp: 1,
				metadata: { teamSessionId: session.id, requestId: "policy-delta" },
			},
		]);
		const extensions = createAgentTeamExtensionRegistry([
			{
				contextPolicies: new Map([
					[
						"public-results-v1",
						{
							id: "public-results-v1",
							project,
						},
					],
				]),
			},
		]);
		const fixture = await createFixture(extensions);
		const [memberId] = fixture.members;
		const turn = fixture.turn(memberId, "custom context");
		const send = fixture.service.send(fixture.session.id, {
			requestId: "custom-context",
			text: "custom context",
			targetMemberIds: [memberId],
		});
		await turn.started.promise;
		turn.finish.resolve();
		await send;
		const sessionId = fixture.session.memberRuntime[memberId]!.sessionId;
		const previous = fixture.pinnedContexts.get(sessionId);
		text = "new policy";
		project.mockClear();
		fixture.stopRuntime();
		await fixture.restartService().read(fixture.session.id, fixture.session.coordinationRuntime!.sessionPath);
		const restored = await fixture.sessionConfigs.get(sessionId)?.bindPinnedModelContext?.({
			sessionId,
			operationId: "restored-manual",
			reason: "manual_compaction",
			signal: new AbortController().signal,
		});
		expect(restored).toEqual(previous);
		expect(restored?.records[0]?.content).toContain(`admitted:${memberId}`);
		expect(project).not.toHaveBeenCalled();
	});

	it("does not advance the member context reference until its receipt is durable and can retry admission", async () => {
		const fixture = await createFixture();
		const [memberId] = fixture.members;
		const append = fixture.runtime.appendSessionMetadataEntry;
		let failReceipt = true;
		vi.spyOn(fixture.runtime, "appendSessionMetadataEntry").mockImplementation(async (id, type, data) => {
			if (type === "agent-team.context-receipt.v1" && failReceipt) {
				failReceipt = false;
				throw new Error("receipt unavailable");
			}
			await append(id, type, data);
		});
		const input = { requestId: "receipt-retry", text: "retry admission", targetMemberIds: [memberId] };
		await expect(fixture.service.send(fixture.session.id, input)).rejects.toThrow("receipt unavailable");
		expect(
			(await fixture.service.read(fixture.session.id)).memberRuntime[memberId]?.sharedCheckpointId,
		).toBeUndefined();
		expect(fixture.runtime.prompt).not.toHaveBeenCalled();
		const turn = fixture.turn(memberId, input.text);
		const retry = fixture.service.send(fixture.session.id, input);
		await turn.started.promise;
		turn.finish.resolve();
		await retry;
		expect(
			fixture.pinnedContexts.get(fixture.session.memberRuntime[memberId]!.sessionId)?.records[0]?.content,
		).toContain("Earlier public context");
	});

	it("restores admitted context after Runtime and Team restart without executing a member", async () => {
		const fixture = await createFixture();
		const [memberId] = fixture.members;
		const turn = fixture.turn(memberId, "before restart");
		const send = fixture.service.send(fixture.session.id, {
			requestId: "restart-context",
			text: "before restart",
			targetMemberIds: [memberId],
		});
		await turn.started.promise;
		turn.finish.resolve();
		await send;
		const sessionId = fixture.session.memberRuntime[memberId]!.sessionId;
		const previous = fixture.pinnedContexts.get(sessionId);
		fixture.stopRuntime();
		const restored = fixture.restartService();
		await restored.read(fixture.session.id, fixture.session.coordinationRuntime!.sessionPath);
		const pinned = await fixture.sessionConfigs.get(sessionId)?.bindPinnedModelContext?.({
			sessionId,
			operationId: "restored-manual",
			reason: "manual_compaction",
			signal: new AbortController().signal,
		});
		expect(pinned).toEqual(previous);
		expect(pinned?.records[0]?.content).toContain("Earlier public context");
		expect(fixture.runtime.prompt).toHaveBeenCalledTimes(1);
	});

	it("completes a prepared publication after restart without running the member again", async () => {
		const fixture = await createFixture();
		const [member] = fixture.members;
		const turn = fixture.turn(member, "publish-before-crash");
		fixture.failNextPublicAppend();
		const send = fixture.service.send(fixture.session.id, {
			requestId: "publish-before-crash",
			text: "publish-before-crash",
			targetMemberIds: [member],
		});
		await turn.started.promise;
		turn.finish.resolve();
		await expect(send).rejects.toThrow("simulated publication crash");
		expect((await fixture.service.readCollaborationState(fixture.session.id)).workItems[0]?.state).toBe("waiting");

		const restored = fixture.restartService();
		await restored.read(fixture.session.id, fixture.session.coordinationRuntime!.sessionPath);
		await fixture.flushObservations();
		const state = await restored.readCollaborationState(fixture.session.id);
		expect(state.workItems[0]).toMatchObject({ state: "completed", resultMessageId: expect.any(String) });
		expect(state.attempts[0]?.state).toBe("completed");
		expect(state.publications[0]?.state).toBe("completed");
		expect(fixture.runtime.prompt).toHaveBeenCalledTimes(1);
		const publications = fixture.observationRecords.filter(
			(record) => record.token === AGENT_TEAM_PUBLICATION_LIFECYCLE,
		);
		expect(publications.map(({ payload }) => payload)).toEqual([
			expect.objectContaining({ phase: "prepared", recovered: false }),
			expect.objectContaining({ phase: "message-published", recovered: true }),
			expect.objectContaining({ phase: "completed", recovered: true }),
		]);
	});

	it("migrates a restored legacy event log once and resumes from ordinary Conversation state", async () => {
		const fixture = await createFixture();
		const [leader, reviewer] = fixture.members;
		const user = createLegacyTeamUserMessageEvent({
			teamSessionId: fixture.session.id,
			requestId: "legacy-user",
			text: "Legacy request",
			targetMemberIds: [leader],
			timestamp: 10,
		});
		const delegation = createLegacyTeamMemberDelegationEvent({
			teamSessionId: fixture.session.id,
			requestId: "legacy-review",
			sourceMemberId: leader,
			targetMemberId: reviewer,
			objective: "Legacy review",
			timestamp: 20,
		});
		const result = createLegacyTeamMemberResultEvent({
			teamSessionId: fixture.session.id,
			requestId: "legacy-review",
			memberId: reviewer,
			sourceTurnId: "legacy-review-turn",
			text: "Legacy review complete",
			timestamp: 30,
		});
		fixture.saved.set(fixture.session.id, { ...fixture.session, events: [user, delegation, result] });
		fixture.stopRuntime();

		const restored = fixture.restartService();
		const migrated = await restored.read(fixture.session.id);
		expect(migrated.events).toEqual([]);
		const snapshot = await restored.readSnapshot(fixture.session.id);
		expect(snapshot.messages.filter((message) => message.id === user.id || message.id === result.id)).toEqual([
			expect.objectContaining({ id: user.id, kind: "user" }),
			expect.objectContaining({
				id: result.id,
				kind: "agent",
				author: expect.objectContaining({ kind: "agent", id: reviewer }),
			}),
		]);
		expect(snapshot.activities).toContainEqual(
			expect.objectContaining({
				requestId: "legacy-review",
				sourceMemberId: leader,
				targetMemberId: reviewer,
				state: "completed",
			}),
		);
		const entryCount = fixture.conversations.get(fixture.session.coordinationRuntime!.sessionId)!.entries.length;
		fixture.stopRuntime();
		await fixture.restartService().read(fixture.session.id, fixture.session.coordinationRuntime!.sessionPath);
		expect(fixture.conversations.get(fixture.session.coordinationRuntime!.sessionId)!.entries).toHaveLength(
			entryCount,
		);
	});

	it("recovers an orphaned running attempt after restart", async () => {
		const fixture = await createFixture();
		const [member] = fixture.members;
		const coordinationId = fixture.session.coordinationRuntime!.sessionId;
		const workItemId = `work:orphan:${member}`;
		const attemptId = `attempt:${workItemId}:1`;
		await fixture.runtime.appendSessionMetadataEntry(coordinationId, "agent-team.work-item.v1", {
			id: workItemId,
			requestTurnId: "orphan",
			createdByParticipantId: fixture.session.leaderMemberId,
			assignedToParticipantId: member,
			objective: "orphan objective",
			contextEntryIds: [],
			state: "running",
			currentAttemptId: attemptId,
			createdAt: 1,
			updatedAt: 1,
			revision: 1,
		});
		await fixture.runtime.appendSessionMetadataEntry(coordinationId, "agent-team.member-attempt.v1", {
			id: attemptId,
			workItemId,
			participantConversationId: fixture.session.memberRuntime[member]!.sessionId,
			sourceTurnId: "orphan-source",
			attempt: 1,
			mode: "initial",
			state: "running",
			lastProgressAt: 1,
		});
		const retry = fixture.turn(member, "retry");
		const restored = fixture.restartService();
		await restored.read(fixture.session.id, fixture.session.coordinationRuntime!.sessionPath);
		await retry.started.promise;
		const completed = fixture.workState(workItemId, "completed");
		retry.finish.resolve();
		await completed;
		const state = await restored.readCollaborationState(fixture.session.id);
		expect(state.attempts.map((attempt) => attempt.state)).toEqual(["waiting-retry", "completed"]);
		expect(state.workItems[0]?.state).toBe("completed");
	});

	it("recovers a pending question delivery after restart", async () => {
		const fixture = await createFixture();
		const [leader, member] = fixture.members;
		const controller = new AbortController();
		fixture.abortAfterPendingDelivery(controller);
		const prompt = `Answer this public question from @${fixture.session.memberHandles[leader]}: Resume the review?`;
		const turn = fixture.turn(member, prompt);
		await expect(
			fixture.service.messageControls(fixture.session.id).sendMessage({
				...taskCaller(fixture, leader),
				signal: controller.signal,
				requestId: "pending-question",
				recipientHandles: [fixture.session.memberHandles[member]!],
				intent: "question",
				text: "Resume the review?",
				modelIdentity: { api: "openai-responses", provider: "openai", model: "test" },
			}),
		).rejects.toThrow();
		expect((await fixture.service.readCollaborationState(fixture.session.id)).deliveries[0]?.state).toBe("pending");

		const restored = fixture.restartService();
		await restored.read(fixture.session.id, fixture.session.coordinationRuntime!.sessionPath);
		await turn.started.promise;
		const deliveryId = (await restored.readCollaborationState(fixture.session.id)).deliveries[0]!.id;
		const responded = fixture.deliveryState(deliveryId, "responded");
		turn.finish.resolve();
		await responded;
		expect((await restored.readCollaborationState(fixture.session.id)).deliveries[0]).toMatchObject({
			state: "responded",
			replyMessageId: expect.any(String),
		});
	});

	it("publishes inform deliveries without starting recipients and injects the message on their next turn", async () => {
		const fixture = await createFixture();
		const [leader, member] = fixture.members;
		const controls = fixture.service.messageControls(fixture.session.id);
		const sent = await controls.sendMessage({
			...taskCaller(fixture, leader),
			requestId: "notice",
			recipientHandles: [fixture.session.memberHandles[member]!],
			intent: "inform",
			text: "Use the revised API",
			modelIdentity: { api: "openai-responses", provider: "openai", model: "test" },
		});
		expect(fixture.runtime.prompt).not.toHaveBeenCalled();
		expect((await fixture.service.readCollaborationState(fixture.session.id)).deliveries).toMatchObject([
			{
				id: sent.deliveryIds[0],
				messageId: sent.messageId,
				fromParticipantId: leader,
				toParticipantId: member,
				intent: "inform",
				state: "delivered",
			},
		]);
		const later = fixture.turn(member, "Continue");
		const completed = fixture.service.send(fixture.session.id, {
			requestId: "later",
			text: "Continue",
			targetMemberIds: [member],
		});
		await later.started.promise;
		expect(fixture.pinnedContexts.get(fixture.session.memberRuntime[member]!.sessionId)?.records).toEqual(
			expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining("Use the revised API") })]),
		);
		expect(JSON.stringify(vi.mocked(fixture.runtime.deliverSessionContext).mock.calls)).not.toContain(
			"Use the revised API",
		);
		later.finish.resolve();
		await completed;
	});

	it("creates independent question deliveries and runs all addressed members in parallel", async () => {
		const fixture = await createFixture();
		const [leader, first] = fixture.members;
		const second = fixture.team.members[2]?.id;
		if (!second) throw new Error("Team fixture requires three members");
		const prompt = `Answer this public question from @${fixture.session.memberHandles[leader]}: Which risks remain?`;
		const firstTurn = fixture.turn(first, prompt);
		const secondTurn = fixture.turn(second, prompt);
		const controls = fixture.service.messageControls(fixture.session.id);
		const caller = taskCaller(fixture, leader);
		const sent = await controls.sendMessage({
			...caller,
			requestId: "review",
			recipientHandles: [fixture.session.memberHandles[first]!, fixture.session.memberHandles[second]!],
			intent: "question",
			text: "Which risks remain?",
			modelIdentity: { api: "openai-responses", provider: "openai", model: "test" },
		});
		await Promise.all([firstTurn.started.promise, secondTurn.started.promise]);
		expect(fixture.running.size).toBe(2);
		const responded = sent.deliveryIds.map((id) => fixture.deliveryState(id, "responded"));
		const completedWork = sent.deliveryIds.map((id, index) =>
			fixture.workState(`work:question:${id}:${[first, second][index]}`, "completed"),
		);
		firstTurn.finish.resolve();
		secondTurn.finish.resolve();
		await Promise.all(completedWork);
		await Promise.all(responded);
		const state = await fixture.service.readCollaborationState(fixture.session.id);
		expect(state.deliveries).toHaveLength(2);
		expect(state.workItems.every((item) => item.originToolCallId === caller.toolCallId)).toBe(true);
		expect(state.deliveries.every((delivery) => delivery.state === "responded" && !!delivery.replyMessageId)).toBe(
			true,
		);
		expect(state.workItems.filter((item) => item.kind === "question").map((item) => item.state)).toEqual([
			"completed",
			"completed",
		]);
		for (const member of [first, second]) {
			expect((await fixture.service.read(fixture.session.id)).memberRuntime[member]?.deliveredEventIds).toContain(
				sent.messageId,
			);
		}
	});

	it("delegates durable tasks without waiting and observes completion through task state", async () => {
		const fixture = await createFixture();
		const [leader, member] = fixture.members;
		const turn = fixture.turn(member, "Build the feature");
		const tasks = fixture.service.taskControls(fixture.session.id);
		const caller = taskCaller(fixture, leader);
		const admitted = await tasks.delegateTask({
			...caller,
			requestId: "build",
			targetHandle: fixture.session.memberHandles[member]!,
			objective: "Build the feature",
		});
		const duplicate = await tasks.delegateTask({
			...caller,
			requestId: "build",
			targetHandle: fixture.session.memberHandles[member]!,
			objective: "Build the feature",
		});
		expect(duplicate.teamTaskId).toBe(admitted.teamTaskId);
		expect(admitted).toMatchObject({
			teamTaskId: expect.stringContaining("work:task:"),
			workItem: {
				assignedToParticipantId: member,
				createdByParticipantId: leader,
				originToolCallId: caller.toolCallId,
				state: "queued",
			},
		});
		await turn.started.promise;
		expect(fixture.runtime.prompt).toHaveBeenCalledTimes(1);
		const running = await tasks.waitTasks({ ...caller, teamTaskIds: [admitted.teamTaskId], timeoutMs: 0 });
		expect(running).toMatchObject({ reason: "timeout", tasks: [{ workItem: { state: "running" } }] });
		const completedWait = tasks.waitTasks({ ...caller, teamTaskIds: [admitted.teamTaskId], timeoutMs: 1_000 });
		turn.finish.resolve();
		const completed = await completedWait;
		expect(completed).toMatchObject({
			reason: "state-changed",
			tasks: [
				{
					workItem: { state: "completed", resultMessageId: expect.any(String) },
					result: { authorId: member, text: "Build the feature" },
				},
			],
		});
		expect(await tasks.getTask({ ...caller, teamTaskId: admitted.teamTaskId })).toEqual(completed.tasks[0]);
	});

	it("cancels only a task wait while the accepted task continues", async () => {
		const fixture = await createFixture();
		const [leader, member] = fixture.members;
		const turn = fixture.turn(member, "Long task");
		const tasks = fixture.service.taskControls(fixture.session.id);
		const caller = taskCaller(fixture, leader);
		const admitted = await tasks.delegateTask({
			...caller,
			requestId: "long",
			targetHandle: fixture.session.memberHandles[member]!,
			objective: "Long task",
		});
		await turn.started.promise;
		const waitController = new AbortController();
		const wait = tasks.waitTasks({
			...caller,
			signal: waitController.signal,
			teamTaskIds: [admitted.teamTaskId],
			timeoutMs: 1_000,
		});
		const rejected = expect(wait).rejects.toThrow("Stop waiting");
		waitController.abort(new Error("Stop waiting"));
		await rejected;
		expect((await tasks.getTask({ ...caller, teamTaskId: admitted.teamTaskId })).workItem.state).toBe("running");
		turn.finish.resolve();
		const completed = await tasks.waitTasks({ ...caller, teamTaskIds: [admitted.teamTaskId], timeoutMs: 1_000 });
		expect(completed.tasks[0]?.workItem.state).toBe("completed");
	});

	it("enforces leader ownership and cancels one task without affecting its sibling", async () => {
		const fixture = await createFixture();
		const [leader, first] = fixture.members;
		const second = fixture.team.members[2]?.id;
		if (!second) throw new Error("Team fixture requires three members");
		const firstTurn = fixture.turn(first, "First task");
		const secondTurn = fixture.turn(second, "Second task");
		const tasks = fixture.service.taskControls(fixture.session.id);
		const leaderCall = taskCaller(fixture, leader);
		await expect(
			tasks.delegateTask({
				...taskCaller(fixture, first),
				requestId: "forbidden",
				targetHandle: fixture.session.memberHandles[second]!,
				objective: "Transfer ownership",
			}),
		).rejects.toThrow("not permitted");
		const firstTask = await tasks.delegateTask({
			...leaderCall,
			requestId: "first-task",
			targetHandle: fixture.session.memberHandles[first]!,
			objective: "First task",
		});
		const secondTask = await tasks.delegateTask({
			...leaderCall,
			requestId: "second-task",
			targetHandle: fixture.session.memberHandles[second]!,
			objective: "Second task",
		});
		await Promise.all([firstTurn.started.promise, secondTurn.started.promise]);
		await tasks.cancelTask({ ...leaderCall, teamTaskId: firstTask.teamTaskId });
		const firstSettled = await tasks.waitTasks({
			...leaderCall,
			teamTaskIds: [firstTask.teamTaskId],
			timeoutMs: 1_000,
		});
		expect(firstSettled.tasks[0]?.workItem.state).toBe("cancelled");
		expect(fixture.running.has(fixture.session.memberRuntime[second]!.sessionId)).toBe(true);
		secondTurn.finish.resolve();
		const secondSettled = await tasks.waitTasks({
			...leaderCall,
			teamTaskIds: [secondTask.teamTaskId],
			timeoutMs: 1_000,
		});
		expect(secondSettled.tasks[0]?.workItem.state).toBe("completed");
	});

	it("releases the durable attempt if context projection fails before the runtime starts", async () => {
		const fixture = await createFixture(
			createAgentTeamExtensionRegistry([
				{
					contextPolicies: new Map([
						[
							"public-results-v1",
							{
								id: "public-results-v1",
								project: () => {
									throw new Error("Context extension unavailable");
								},
							},
						],
					]),
				},
			]),
		);
		await expect(
			fixture.service.send(fixture.session.id, {
				requestId: "projection-error",
				text: "inspect",
				targetMemberIds: [fixture.members[0]],
			}),
		).rejects.toThrow("Context extension unavailable");
		const state = await fixture.service.readCollaborationState(fixture.session.id);
		expect(state.workItems[0]?.state).toBe("waiting");
		expect(state.attempts[0]?.state).toBe("interrupted");
		expect(fixture.runtime.prompt).not.toHaveBeenCalled();
	});

	it("recovers an interrupted member while its sibling is running and joins duplicate recovery", async () => {
		const fixture = await createFixture();
		const [first, second] = fixture.members;
		const interrupted = fixture.turn(first, "initial");
		interrupted.failure = {
			code: "provider_network_timeout",
			message: "timeout",
			retryable: true,
			origin: "provider",
		};
		const sibling = fixture.turn(second, "initial");
		const retry = fixture.turn(first, "retry");
		const waiting = fixture.workState(`work:initial:${first}`, "waiting");
		const initial = fixture.service.send(fixture.session.id, {
			requestId: "initial",
			text: "initial",
			targetMemberIds: [first, second],
		});
		await Promise.all([interrupted.started.promise, sibling.started.promise]);
		interrupted.finish.resolve();
		await waiting;
		const recovery = fixture.service.recoverWorkItem(fixture.session.id, `work:initial:${first}`, "retry");
		const duplicate = fixture.service.recoverWorkItem(fixture.session.id, `work:initial:${first}`, "retry");
		await retry.started.promise;
		expect(fixture.running.size).toBe(2);
		retry.finish.resolve();
		await Promise.all([recovery, duplicate]);
		expect(fixture.runtime.retry).toHaveBeenCalledTimes(1);
		sibling.finish.resolve();
		await initial;
		const state = await fixture.service.readCollaborationState(fixture.session.id);
		expect(state.workItems.map((item) => item.state)).toEqual(["completed", "completed"]);
		expect(state.attempts).toHaveLength(3);
	});

	it("retries an attention-required member only after a matching provider access change", async () => {
		const fixture = await createFixture();
		const [member] = fixture.members;
		const initial = fixture.turn(member, "auth-task");
		initial.failure = {
			code: "provider_unauthorized",
			message: "unauthorized",
			retryable: false,
			origin: "provider",
			details: { provider: "openai", modelId: "gpt-5" },
		};
		const retry = fixture.turn(member, "retry");
		const send = fixture.service.send(fixture.session.id, {
			requestId: "auth-task",
			text: "auth-task",
			targetMemberIds: [member],
		});
		await initial.started.promise;
		initial.finish.resolve();
		await send;
		expect((await fixture.service.readCollaborationState(fixture.session.id)).workItems[0]?.state).toBe(
			"attention-required",
		);

		await expect(
			fixture.service.notifyExternalConditionChanged({ category: "authentication", provider: "anthropic" }),
		).resolves.toBe(0);
		await expect(
			fixture.service.notifyExternalConditionChanged({ category: "authentication", provider: "openai" }),
		).resolves.toBe(1);
		await retry.started.promise;
		const completed = fixture.workState(`work:auth-task:${member}`, "completed");
		retry.finish.resolve();
		await completed;

		const state = await fixture.service.readCollaborationState(fixture.session.id);
		expect(state.workItems[0]?.state).toBe("completed");
		expect(state.attempts.map((attempt) => attempt.state)).toEqual(["awaiting-resource", "completed"]);
		expect(fixture.runtime.retry).toHaveBeenCalledTimes(1);
	});

	it("remembers an external change during a running attempt and retries after that attempt settles", async () => {
		const fixture = await createFixture();
		const [member] = fixture.members;
		const initial = fixture.turn(member, "auth-race");
		initial.failure = {
			code: "provider_unauthorized",
			message: "unauthorized",
			retryable: false,
			origin: "provider",
			details: { provider: "openai" },
		};
		const retry = fixture.turn(member, "retry");
		const send = fixture.service.send(fixture.session.id, {
			requestId: "auth-race",
			text: "auth-race",
			targetMemberIds: [member],
		});
		await initial.started.promise;
		await expect(
			fixture.service.notifyExternalConditionChanged({ category: "authentication", provider: "openai" }),
		).resolves.toBe(0);
		initial.finish.resolve();
		await retry.started.promise;
		const completed = fixture.workState(`work:auth-race:${member}`, "completed");
		retry.finish.resolve();
		await send;
		await completed;

		const state = await fixture.service.readCollaborationState(fixture.session.id);
		expect(state.attempts.map((attempt) => attempt.state)).toEqual(["awaiting-resource", "completed"]);
		expect(fixture.runtime.retry).toHaveBeenCalledTimes(1);
	});

	it("automatically retries a transient provider failure after its persisted retry deadline", async () => {
		const fixture = await createFixture();
		const [member] = fixture.members;
		const initial = fixture.turn(member, "network-task");
		initial.failure = {
			code: "provider_network_timeout",
			message: "timeout",
			retryable: true,
			origin: "provider",
			details: { provider: "openai", retryAfterMs: 0 },
		};
		const retry = fixture.turn(member, "retry");
		const send = fixture.service.send(fixture.session.id, {
			requestId: "network-task",
			text: "network-task",
			targetMemberIds: [member],
		});
		await initial.started.promise;
		initial.finish.resolve();
		await retry.started.promise;
		const completed = fixture.workState(`work:network-task:${member}`, "completed");
		retry.finish.resolve();
		await send;
		await completed;

		const state = await fixture.service.readCollaborationState(fixture.session.id);
		expect(state.attempts.map((attempt) => attempt.state)).toEqual(["waiting-retry", "completed"]);
		expect(fixture.runtime.retry).toHaveBeenCalledTimes(1);
	});

	it("persists a queued second request without starting a second turn in the same member", async () => {
		const fixture = await createFixture();
		const [member] = fixture.members;
		const firstTurn = fixture.turn(member, "first");
		const nextTurn = fixture.turn(member, "next");
		const firstSend = fixture.service.send(fixture.session.id, {
			requestId: "first",
			text: "first",
			targetMemberIds: [member],
		});
		await firstTurn.started.promise;
		const queued = fixture.workState(`work:next:${member}`, "queued");
		const nextSend = fixture.service.send(fixture.session.id, {
			requestId: "next",
			text: "next",
			targetMemberIds: [member],
		});
		await queued;
		expect(fixture.runtime.prompt).toHaveBeenCalledTimes(1);
		firstTurn.finish.resolve();
		await firstSend;
		await nextTurn.started.promise;
		nextTurn.finish.resolve();
		await nextSend;
		expect(fixture.runtime.prompt).toHaveBeenCalledTimes(2);
		expect(
			(await fixture.service.readCollaborationState(fixture.session.id)).workItems.map((item) => item.state),
		).toEqual(["completed", "completed"]);
	});

	it("joins duplicate requests without executing the member twice", async () => {
		const fixture = await createFixture();
		const [member] = fixture.members;
		const turn = fixture.turn(member, "same");
		const request = { requestId: "same", text: "same", targetMemberIds: [member] };
		const first = fixture.service.send(fixture.session.id, request);
		await turn.started.promise;
		const duplicate = fixture.service.send(fixture.session.id, request);
		turn.finish.resolve();
		await Promise.all([first, duplicate]);
		expect(fixture.runtime.prompt).toHaveBeenCalledTimes(1);
		expect((await fixture.service.readCollaborationState(fixture.session.id)).attempts).toHaveLength(1);
		expect(
			(await fixture.service.readSnapshot(fixture.session.id)).messages.filter(
				(message) => message.turnId === request.requestId,
			),
		).toHaveLength(2);
	});

	it("cancels running and queued requests without starting the queued member turn", async () => {
		const fixture = await createFixture();
		const [first, second] = fixture.members;
		const firstTurn = fixture.turn(first, "active");
		const secondTurn = fixture.turn(second, "active");
		fixture.turn(first, "queued");
		const active = fixture.service.send(fixture.session.id, {
			requestId: "active",
			text: "active",
			targetMemberIds: [first, second],
		});
		await Promise.all([firstTurn.started.promise, secondTurn.started.promise]);
		const queued = fixture.workState(`work:queued:${first}`, "queued");
		const next = fixture.service.send(fixture.session.id, {
			requestId: "queued",
			text: "queued",
			targetMemberIds: [first],
		});
		const settled = Promise.allSettled([active, next]);
		await queued;
		await fixture.service.abort(fixture.session.id);
		expect((await settled).every((result) => result.status === "rejected")).toBe(true);
		expect(fixture.runtime.prompt).toHaveBeenCalledTimes(2);
		expect(fixture.runtime.abort).toHaveBeenCalledTimes(2);
		const state = await fixture.service.readCollaborationState(fixture.session.id);
		expect(state.workItems.map((item) => item.state)).toEqual(["cancelled", "cancelled", "cancelled"]);
		expect(state.attempts).toHaveLength(2);
	});

	it("runs different members together and retains both publications and delivery receipts", async () => {
		const fixture = await createFixture();
		const [first, second] = fixture.members;
		const firstTurn = fixture.turn(first, "parallel");
		const secondTurn = fixture.turn(second, "parallel");
		const completed = fixture.service.send(fixture.session.id, {
			requestId: "parallel",
			text: "parallel",
			targetMemberIds: [first, second],
		});
		try {
			await Promise.all([firstTurn.started.promise, secondTurn.started.promise]);
			expect(fixture.running.size).toBe(2);
			secondTurn.finish.resolve();
			firstTurn.finish.resolve();
			await completed;
			const saved = await fixture.service.read(fixture.session.id);
			const collaboration = await fixture.service.readCollaborationState(saved.id);
			expect(
				(await fixture.service.readSnapshot(saved.id)).messages
					.filter((message) => message.kind === "agent" && message.turnId === "parallel")
					.map((message) => message.author.id)
					.sort(),
			).toEqual([first, second].sort());
			for (const member of [first, second]) {
				expect(saved.memberRuntime[member]?.deliveredEventIds).toContain("earlier-message");
			}
			const reopened = fixture.restartService();
			expect(await reopened.read(saved.id, saved.coordinationRuntime!.sessionPath)).toEqual(saved);
			expect(collaboration.workItems.map((item) => item.state)).toEqual(["completed", "completed"]);
			expect(collaboration.checkpoints).toHaveLength(1);
			expect(collaboration.contextGenerations).toHaveLength(1);
			expect(collaboration.contextReceipts).toHaveLength(2);
			const checkpoint = collaboration.checkpoints[0];
			const generation = collaboration.contextGenerations[0];
			if (!checkpoint || !generation) throw new Error("Expected one shared Team context generation");
			expect(new Set(collaboration.contextReceipts.map((receipt) => receipt.generationId))).toEqual(
				new Set([generation.id]),
			);
			expect(new Set(collaboration.contextReceipts.map((receipt) => receipt.checkpointId))).toEqual(
				new Set([checkpoint.id]),
			);
			const delivered = new Map(
				vi.mocked(fixture.runtime.deliverSessionContext).mock.calls.map((call) => [call[0], call[1]]),
			);
			const visiblePrefix = (memberId: string) =>
				fixture.pinnedContexts.get(saved.memberRuntime[memberId]!.sessionId)?.records;
			expect(visiblePrefix(first)).toEqual(visiblePrefix(second));
			expect(visiblePrefix(first)).toHaveLength(1);
			expect(visiblePrefix(first)?.[0]?.content).toContain("Earlier public context");
			for (const memberId of [first, second]) {
				const sessionId = saved.memberRuntime[memberId]!.sessionId;
				const idleContext = await fixture.sessionConfigs.get(sessionId)?.bindPinnedModelContext?.({
					sessionId,
					operationId: "manual-after-turn",
					reason: "manual_compaction",
					signal: new AbortController().signal,
				});
				expect(idleContext?.records).toEqual(visiblePrefix(memberId));
			}
			const firstConfig = fixture.sessionConfigs.get(saved.memberRuntime[first]!.sessionId)!;
			const secondConfig = fixture.sessionConfigs.get(saved.memberRuntime[second]!.sessionId)!;
			expect(firstConfig.promptCacheKey).toBe(secondConfig.promptCacheKey);
			expect(firstConfig.systemPromptCachePrefixAddon).toBe(secondConfig.systemPromptCachePrefixAddon);
			expect(firstConfig.systemPromptCachePrefixAddon).toContain("<agent_team_operating_context>");
			expect(firstConfig.systemPromptVolatileAddon).toContain("<agent_team_member_identity>");
			expect(secondConfig.systemPromptVolatileAddon).toContain("<agent_team_member_identity>");
			expect(firstConfig.systemPromptVolatileAddon).not.toBe(secondConfig.systemPromptVolatileAddon);
			const expectedReference = JSON.stringify({
				sharedCheckpointId: checkpoint.id,
				throughConversationRevision: checkpoint.throughConversationRevision,
				sourceFingerprint: checkpoint.sourceFingerprint,
				projectionPolicyId: checkpoint.policyVersion,
			});
			for (const member of [first, second]) {
				expect(delivered.get(saved.memberRuntime[member]!.sessionId)?.every((record) => !record.modelVisible)).toBe(
					true,
				);
				expect(delivered.get(saved.memberRuntime[member]!.sessionId)).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							type: "agent-team.compaction-reference.v1",
							content: expectedReference,
							modelVisible: false,
						}),
					]),
				);
			}
		} finally {
			firstTurn.finish.resolve();
			secondTurn.finish.resolve();
			await completed.catch(() => undefined);
		}
	});

	it("reads only caller-authorized public history through a stable bounded cursor", async () => {
		const fixture = await createFixture();
		const [first, second] = fixture.members;
		const coordinationId = fixture.session.coordinationRuntime!.sessionId;
		await fixture.runtime.appendConversationMessage(coordinationId, {
			id: "first-public",
			turnId: "first-turn",
			kind: "agent",
			author: { kind: "agent", id: first },
			message: {
				...createAssistantMessage({ api: "openai-responses", provider: "openai", model: "test" }),
				content: [{ type: "text", text: "private-to-author-but-publicly-published" }],
			},
			timestamp: 2,
		});
		await fixture.runtime.appendConversationMessage(coordinationId, {
			id: "second-public",
			turnId: "second-turn",
			kind: "agent",
			author: { kind: "agent", id: second },
			message: {
				...createAssistantMessage({ api: "openai-responses", provider: "openai", model: "test" }),
				content: [{ type: "text", text: "visible teammate result" }],
			},
			timestamp: 3,
		});
		const port = fixture.service.sharedHistoryControls(fixture.session.id);
		const firstConfig = fixture.sessionConfigs.get(fixture.session.memberRuntime[first]!.sessionId);
		expect(firstConfig?.sessionRuntimeTools?.map(({ tool }) => tool.name)).toContain("team_read_shared_history");
		const signal = new AbortController().signal;
		const firstPage = await port.readSharedHistory({
			sourceRuntimeSessionId: fixture.session.memberRuntime[first]!.sessionId,
			signal,
			maxRecords: 1,
		});
		expect(firstPage.records.map(({ sourceEntryId }) => sourceEntryId)).toEqual(["earlier-message"]);
		await fixture.runtime.appendConversationMessage(coordinationId, {
			id: "later-public",
			turnId: "later-turn",
			kind: "user",
			author: { kind: "user", id: "local-user" },
			message: { role: "user", content: "newer public message", timestamp: 4 },
			timestamp: 4,
		});
		const secondPage = await port.readSharedHistory({
			sourceRuntimeSessionId: fixture.session.memberRuntime[first]!.sessionId,
			signal,
			cursor: firstPage.nextCursor,
		});
		expect(secondPage.records.map(({ sourceEntryId }) => sourceEntryId)).toEqual(["second-public"]);
		expect(JSON.stringify(secondPage)).not.toContain("private-to-author-but-publicly-published");
		expect(JSON.stringify(secondPage)).not.toContain("newer public message");
		await expect(port.readSharedHistory({ sourceRuntimeSessionId: "outside-runtime", signal })).rejects.toThrow(
			/active persistent member/,
		);
	});

	it("does not block a different member behind another user request", async () => {
		const fixture = await createFixture();
		const [first, second] = fixture.members;
		const firstTurn = fixture.turn(first, "first");
		const secondTurn = fixture.turn(second, "second");
		const firstSend = fixture.service.send(fixture.session.id, {
			requestId: "first",
			text: "first",
			targetMemberIds: [first],
		});
		await firstTurn.started.promise;
		const secondSend = fixture.service.send(fixture.session.id, {
			requestId: "second",
			text: "second",
			targetMemberIds: [second],
		});
		try {
			await secondTurn.started.promise;
			expect(fixture.running.size).toBe(2);
		} finally {
			firstTurn.finish.resolve();
			secondTurn.finish.resolve();
			await Promise.all([firstSend, secondSend]);
		}
		const messages = (await fixture.service.readSnapshot(fixture.session.id)).messages.filter(
			(message) => message.turnId === "first" || message.turnId === "second",
		);
		expect(messages).toHaveLength(4);
	});
});

async function createFixture(extensions?: AgentTeamExtensionRegistry) {
	const document = createAgentTeamFixture();
	const team = document.teams[0];
	if (!team || team.members.length < 2) throw new Error("Team fixture requires two members");
	const members: [string, string] = [team.members[0]!.id, team.members[1]!.id];
	const saved = new Map<string, TeamSessionDocument>();
	const conversations = new Map<string, ConversationDocument>();
	const history = new Map<string, ReturnType<RuntimeHost["getFullHistory"]>>();
	const turns = new Map<string, TestMemberTurn>();
	const workStates = new Map<string, ReturnType<typeof deferred>>();
	const deliveryStates = new Map<string, ReturnType<typeof deferred>>();
	const activeTurns = new Map<string, { finish: ReturnType<typeof deferred>; aborted: boolean }>();
	const running = new Set<string>();
	const sessionConfigs = new Map<string, DesktopCodingAgentSessionConfig>();
	const pinnedContexts = new Map<string, CodingAgentPinnedModelContext>();
	const observationRecords: RuntimeObservationRecord[] = [];
	const observationPublisher = createRuntimeObservationPublisher({
		port: {
			record: (record) => {
				observationRecords.push(record);
			},
		},
	});
	let sequence = 0;
	let failNextPublicAppend = false;
	let pendingDeliveryAbort: AbortController | undefined;
	const append: RuntimeHost["appendSessionMetadataEntry"] = async (sessionId, customType, data) => {
		const current = conversations.get(sessionId)!;
		const id = `entry-${++sequence}`;
		conversations.set(sessionId, {
			...current,
			entries: [
				...current.entries,
				{
					id,
					parentId: current.activeLeafId,
					type: "custom",
					customType,
					data,
					timestamp: new Date(sequence).toISOString(),
				},
			],
			activeLeafId: id,
		});
		if (customType === "agent-team.work-item.v1" && isTeamWorkItem(data)) {
			workStates.get(`${data.id}:${data.state}`)?.resolve();
		}
		if (customType === "agent-team.message-delivery.v1" && isTeamMessageDelivery(data)) {
			deliveryStates.get(`${data.id}:${data.state}`)?.resolve();
			if (data.state === "pending") {
				pendingDeliveryAbort?.abort();
				pendingDeliveryAbort = undefined;
			}
		}
	};
	const activeSessions = new Set<string>();
	const runtime = {
		createSession: vi.fn(async (config: DesktopCodingAgentSessionConfig) => {
			const sessionId = config.sessionPath
				? /([^/]+)\.jsonl$/.exec(config.sessionPath)?.[1]
				: (config.sessionId ?? `runtime-${++sequence}`);
			if (!sessionId) throw new Error("Invalid fixture session path");
			activeSessions.add(sessionId);
			sessionConfigs.set(sessionId, config);
			if (!conversations.has(sessionId))
				conversations.set(sessionId, createEmptyConversationDocument({ sessionId, createdAt: 1 }));
			return { sessionId };
		}),
		getSessionPath: (id: string) => (activeSessions.has(id) ? `C:/runtime/${id}.jsonl` : undefined),
		setExecutionMode: vi.fn(async () => undefined),
		createObservationScope: (context: RuntimeObservationContext) => observationPublisher.scope(context),
		disposeSession: vi.fn(async () => undefined),
		subscribe: () => () => undefined,
		readSessionDocument: (id: string) => conversations.get(id),
		appendSessionMetadataEntry: append,
		appendConversationMessage: vi.fn(async (id: string, record: ConversationMessageRecord) => {
			const current = conversations.get(id)!;
			if (!current.entries.some((entry) => entry.id === record.id)) {
				conversations.set(id, {
					...current,
					entries: [
						...current.entries,
						{
							...record,
							type: "message",
							parentId: current.activeLeafId,
							timestamp: new Date(record.timestamp).toISOString(),
						},
					],
					activeLeafId: record.id,
				});
			}
			if (record.kind === "agent" && failNextPublicAppend) {
				failNextPublicAppend = false;
				throw new Error("simulated publication crash");
			}
			return { entryId: record.id };
		}),
		deliverSessionContext: vi.fn(
			async (
				_sessionId: string,
				_records: readonly SessionContextRecord[],
				_mode: RuntimeSessionContextDeliveryMode,
			) => undefined,
		),
		getFullHistory: (id: string) => history.get(id) ?? [],
		retry: vi.fn(async (id: string) => runtime.prompt(id, { text: "retry" })),
		prompt: vi.fn(async (id: string, input: { text: string }) => {
			const turn = turns.get(`${id}:${input.text}`);
			if (!turn) throw new Error(`Unexpected member prompt: ${id}:${input.text}`);
			if (running.has(id)) throw new Error("Concurrent prompts in one member conversation");
			const pinned = await sessionConfigs.get(id)?.bindPinnedModelContext?.({
				sessionId: id,
				operationId: input.text,
				reason: "turn",
				signal: new AbortController().signal,
			});
			if (pinned) pinnedContexts.set(id, pinned);
			running.add(id);
			const active = { finish: turn.finish, aborted: false };
			activeTurns.set(id, active);
			turn.started.resolve();
			await turn.finish.promise;
			running.delete(id);
			activeTurns.delete(id);
			if (active.aborted) throw new Error("Member execution aborted");
			if (turn.failure) throw turn.failure;
			const entryId = `answer-${++sequence}`;
			const message = {
				...createAssistantMessage({ api: "openai-responses", provider: "openai", model: "test" }),
				content: [{ type: "text" as const, text: input.text }],
			};
			history.set(id, [...(history.get(id) ?? []), { type: "message", entryId, message }]);
			const current = conversations.get(id)!;
			conversations.set(id, {
				...current,
				entries: [
					...current.entries,
					{
						type: "message",
						id: entryId,
						parentId: current.activeLeafId,
						timestamp: new Date(sequence).toISOString(),
						message,
					},
				],
			});
		}),
		abort: vi.fn(async (id: string) => {
			const active = activeTurns.get(id);
			if (active) {
				active.aborted = true;
				active.finish.resolve();
			}
		}),
	} as unknown as RuntimeHost;
	const service = new AgentTeamSessionService({
		runtime,
		extensions,
		readDocument: async () => document,
		repository: {
			read: async (id) => saved.get(id)!,
		},
	});
	const session = await service.create(team, document, "C:/workspace");
	const coordination = conversations.get(session.coordinationRuntime!.sessionId)!;
	conversations.set(session.coordinationRuntime!.sessionId, {
		...coordination,
		entries: [
			{
				type: "message",
				kind: "user",
				id: "earlier-message",
				turnId: "earlier",
				parentId: null,
				timestamp: new Date(1).toISOString(),
				author: { kind: "user", id: "local-user" },
				message: { role: "user", content: "Earlier public context", timestamp: 1 },
			},
			...coordination.entries,
		],
	});
	return {
		team,
		service,
		session,
		members,
		saved,
		conversations,
		running,
		sessionConfigs,
		pinnedContexts,
		observationRecords,
		runtime,
		flushObservations: () => observationPublisher.flush(),
		stopRuntime() {
			if (running.size > 0) throw new Error("Cannot stop fixture Runtime while a member is running");
			activeSessions.clear();
			sessionConfigs.clear();
			pinnedContexts.clear();
		},
		failNextPublicAppend() {
			failNextPublicAppend = true;
		},
		abortAfterPendingDelivery(controller: AbortController) {
			pendingDeliveryAbort = controller;
		},
		restartService() {
			return new AgentTeamSessionService({
				runtime,
				extensions,
				readDocument: async () => document,
				repository: {
					read: async (id) => saved.get(id)!,
				},
			});
		},
		workState(id: string, state: TeamWorkItem["state"]) {
			const reached = deferred();
			workStates.set(`${id}:${state}`, reached);
			return reached.promise;
		},
		deliveryState(id: string, state: TeamMessageDelivery["state"]) {
			const reached = deferred();
			deliveryStates.set(`${id}:${state}`, reached);
			return reached.promise;
		},
		turn(member: string, text: string) {
			const turn: TestMemberTurn = { started: deferred(), finish: deferred() };
			turns.set(`${session.memberRuntime[member]!.sessionId}:${text}`, turn);
			return turn;
		},
	};
}

function taskCaller(fixture: Awaited<ReturnType<typeof createFixture>>, memberId: string) {
	return {
		sourceRuntimeSessionId: fixture.session.memberRuntime[memberId]!.sessionId,
		sourceTurnId: "leader-turn",
		toolCallId: crypto.randomUUID(),
		signal: new AbortController().signal,
	};
}

interface TestMemberTurn {
	readonly started: ReturnType<typeof deferred>;
	readonly finish: ReturnType<typeof deferred>;
	failure?: unknown;
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
