import {
	applyConversationDocumentCommand,
	type ConversationDocument,
	createEmptyConversationDocument,
} from "@vetta/runtime-core";
import type { ModelCallContributionContext } from "@vetta/runtime-core/kernel";
import { SessionExtensionComposition } from "@vetta/runtime-core/session-extensions";
import { afterEach, describe, expect, it } from "vitest";
import {
	CODING_AGENT_GOAL_CLEAR,
	CODING_AGENT_GOAL_CREATE,
	CODING_AGENT_GOAL_STATE_READ,
	CODING_AGENT_GOAL_UPDATE,
	CodingAgentGoalRuntime,
	createCodingAgentGoalSessionExtension,
	readCodingAgentGoalObservation,
} from "../../../src/features/goal/index.js";

const signal = new AbortController().signal;

describe("Coding Agent goal session extension", () => {
	const disposals: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		for (const dispose of disposals.splice(0).reverse()) await dispose();
	});

	async function createSession(scenario: "conversation" | "batch" = "conversation") {
		let id = 0;
		const composition = await SessionExtensionComposition.create({
			createId: () => `id-${++id}`,
			definitions: [createCodingAgentGoalSessionExtension({ scenario })],
		});
		disposals.push(() => composition.dispose());
		const prepared = await composition.features[0]?.prepare({ signal });
		if (!prepared) return { composition };
		disposals.push(() => prepared.dispose());
		const provider = (await prepared.contribute({ signal })).modelCallProviders?.[0];
		if (!provider) throw new Error("Expected goal model-call provider");
		return {
			composition,
			contribute: () => provider.contribute({ signal } as ModelCallContributionContext),
		};
	}

	it("creates an explicit goal, exposes its instructions, and stops continuation after completion", async () => {
		const session = await createSession();
		const before = await session.contribute?.();
		expect(before?.instructions).toBeUndefined();
		expect(before?.tools?.map(({ name }) => name)).toEqual(["get_goal", "create_goal", "update_goal"]);

		const goal = session.composition.invokeSync(CODING_AGENT_GOAL_CREATE, {
			objective: "Ship a verified goal mode",
		});
		expect(goal).toMatchObject({ objective: "Ship a verified goal mode", status: "active" });
		const active = await session.contribute?.();
		expect(active?.instructions?.[0]?.content).toContain("<goal_objective>\nShip a verified goal mode");
		expect(active?.instructions?.[0]?.content).toContain("untrusted user data");

		expect(session.composition.continuationSources).toHaveLength(1);
		expect(await session.composition.continuationSources[0]?.collect({ signal } as never)).toEqual([
			expect.objectContaining({
				role: "user",
				content: [expect.objectContaining({ text: expect.stringContaining("[ephemeral:goal]") })],
			}),
		]);

		const completed = session.composition.invokeSync(CODING_AGENT_GOAL_UPDATE, {
			goalId: goal.goalId,
			status: "complete",
		});
		expect(completed.status).toBe("complete");
		expect(await session.composition.continuationSources[0]?.collect({ signal } as never)).toEqual([]);
	});

	it("rejects replacement and stale updates while allowing user pause and resume", async () => {
		const { composition } = await createSession();
		const goal = composition.invokeSync(CODING_AGENT_GOAL_CREATE, { objective: "A" });
		expect(() => composition.invokeSync(CODING_AGENT_GOAL_CREATE, { objective: "B" })).toThrow(
			"unfinished goal already exists",
		);
		expect(() => composition.invokeSync(CODING_AGENT_GOAL_UPDATE, { goalId: "old", status: "paused" })).toThrow(
			"Goal id does not match",
		);
		expect(composition.invokeSync(CODING_AGENT_GOAL_UPDATE, { goalId: goal.goalId, status: "paused" }).status).toBe(
			"paused",
		);
		expect(composition.invokeSync(CODING_AGENT_GOAL_UPDATE, { goalId: goal.goalId, status: "active" }).status).toBe(
			"active",
		);
		expect(composition.invokeSync(CODING_AGENT_GOAL_CLEAR, { goalId: goal.goalId })).toBeNull();
		expect(composition.invokeSync(CODING_AGENT_GOAL_STATE_READ, undefined)).toBeNull();
	});

	it("lets the model create an explicitly requested goal and mark it complete through typed tools", async () => {
		const session = await createSession();
		const contribution = await session.contribute?.();
		const createTool = contribution?.tools?.find(({ name }) => name === "create_goal");
		const updateTool = contribution?.tools?.find(({ name }) => name === "update_goal");
		if (!createTool || !updateTool) throw new Error("Expected goal tools");
		await createTool.execute({
			sessionId: "s",
			turnId: "t",
			toolCallId: "create",
			input: { objective: "Finish the explicit request" },
			signal,
		});
		const goal = session.composition.invokeSync(CODING_AGENT_GOAL_STATE_READ, undefined);
		if (!goal) throw new Error("Expected active goal");
		await updateTool.execute({
			sessionId: "s",
			turnId: "t",
			toolCallId: "update",
			input: { goal_id: goal.goalId, status: "complete" },
			signal,
		});
		expect(session.composition.invokeSync(CODING_AGENT_GOAL_STATE_READ, undefined)?.status).toBe("complete");
	});

	it("does not offer autonomous goal mode in unattended scenarios", async () => {
		const { composition } = await createSession("batch");
		expect(composition.features).toHaveLength(0);
		expect(composition.continuationSources).toHaveLength(0);
		expect(() => composition.invokeSync(CODING_AGENT_GOAL_CREATE, { objective: "A" })).toThrow(
			"unavailable in the batch scenario",
		);
	});
});

describe("CodingAgentGoalRuntime persistence and accounting", () => {
	function createRuntime(initial: ConversationDocument, nowValues: number[] = [1]) {
		let document = initial;
		let entry = 0;
		const runtime = new CodingAgentGoalRuntime({
			createId: () => `goal-${++entry}`,
			now: () => nowValues.shift() ?? 1,
		});
		runtime.initialize(document, {
			appendCustomEntry: async (customEntry) => {
				document = applyConversationDocumentCommand(document, { type: "custom.append", ...customEntry }).document;
				runtime.onDocumentChanged(document);
			},
		});
		return { runtime, readDocument: () => document };
	}

	it("persists goals and restores the current branch snapshot", async () => {
		const first = createRuntime(createEmptyConversationDocument({ sessionId: "s", createdAt: 1 }));
		const goal = first.runtime.create("Persist me");
		await first.runtime.flush();
		expect(first.readDocument().entries.at(-1)).toMatchObject({
			type: "custom",
			customType: "goal_snapshot",
			data: { goalId: goal.goalId, objective: "Persist me", status: "active" },
		});
		const resumed = createRuntime(first.readDocument());
		expect(resumed.runtime.readState()).toMatchObject({ objective: "Persist me", status: "paused" });
	});

	it("tracks assistant usage without imposing a token budget", async () => {
		const fixture = createRuntime(createEmptyConversationDocument({ sessionId: "s", createdAt: 1 }));
		fixture.runtime.create("Keep working until the goal is done");
		await fixture.runtime.onSessionEvent({ type: "turn.started" } as never);
		await fixture.runtime.onSessionEvent({
			type: "message.appended",
			message: {
				role: "assistant",
				usage: { totalTokens: 10, input: 4, output: 6, cacheRead: 0, cacheWrite: 0 },
			},
		} as never);
		expect(fixture.runtime.readState()).toMatchObject({ status: "active", tokensUsed: 10 });
	});

	it("rejects malformed persisted goal snapshots", () => {
		const malformed = applyConversationDocumentCommand(
			createEmptyConversationDocument({ sessionId: "s", createdAt: 1 }),
			{
				type: "custom.append",
				entryId: "bad",
				customType: "goal_snapshot",
				data: { status: "active" },
				timestamp: new Date(1).toISOString(),
			},
		).document;
		expect(() => createRuntime(malformed)).toThrow("Invalid goal_snapshot entry: bad");
	});
});

describe("goal observation contract", () => {
	it("accepts valid state and clear observations while rejecting malformed payloads", () => {
		const payload = {
			goalId: "g",
			objective: "Ship",
			status: "active",
			tokensUsed: 0,
			timeUsedSeconds: 0,
			continuationCount: 0,
			createdAt: "t",
			updatedAt: "t",
		};
		const event = { type: "session.extension", extensionId: "coding-agent.goal", event: "changed", payload };
		expect(readCodingAgentGoalObservation(event as never)).toEqual(payload);
		expect(readCodingAgentGoalObservation({ ...event, payload: null } as never)).toBeNull();
		expect(readCodingAgentGoalObservation({ ...event, payload: { status: "active" } } as never)).toBeUndefined();
	});
});
