import {
	applyConversationDocumentCommand,
	type ConversationDocument,
	createEmptyConversationDocument,
} from "@vetta/runtime-core";
import type { ModelCallContribution, ModelCallContributionContext } from "@vetta/runtime-core/kernel";
import { SessionExtensionComposition, SessionExtensionFunctionRegistry } from "@vetta/runtime-core/session-extensions";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CODING_AGENT_PERMISSION_MODE_SET,
	CODING_AGENT_PLAN_MODE_RUNTIME,
	CODING_AGENT_PLAN_MODE_STATE_READ,
	CODING_AGENT_PLAN_REVIEW_FUNCTION,
	CodingAgentPlanModeRuntime,
	type CodingAgentPlanModeState,
	type CodingAgentPlanReviewResult,
	createCodingAgentPlanModeSessionExtension,
	readCodingAgentPlanModeObservation,
} from "../../../src/features/plan-mode/index.js";

const signal = new AbortController().signal;
const callContext = { signal } as ModelCallContributionContext;

describe("Coding Agent plan mode session extension", () => {
	const disposals: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		for (const dispose of disposals.splice(0).reverse()) await dispose();
	});

	async function createSession(
		options: {
			readonly review?: (plan: string) => Promise<CodingAgentPlanReviewResult>;
			readonly scenario?: "conversation" | "batch";
			readonly todo?: boolean;
		} = {},
	) {
		const functions = new SessionExtensionFunctionRegistry();
		disposals.push(() => functions.close());
		const review = options.review;
		if (review) functions.register(CODING_AGENT_PLAN_REVIEW_FUNCTION, ({ plan }) => review(plan));
		const updates: CodingAgentPlanModeState[] = [];
		let id = 0;
		const composition = await SessionExtensionComposition.create({
			createId: () => `id-${++id}`,
			functions,
			definitions: [
				createCodingAgentPlanModeSessionExtension({
					scenario: options.scenario ?? "conversation",
					isTodoToolAvailable: () => options.todo ?? false,
					reportUpdate: (state) => {
						updates.push(state);
					},
				}),
			],
		});
		disposals.push(() => composition.dispose());
		const prepared = await composition.features[0]!.prepare({ signal });
		disposals.push(() => prepared.dispose());
		const provider = (await prepared.contribute({ signal })).modelCallProviders?.[0];
		if (!provider) throw new Error("Expected plan mode model-call provider");
		const bindTurn = async () => {
			const bound = await provider.bindForTurn?.({ signal } as never);
			if (!bound) throw new Error("Expected a turn-bound provider");
			return (): Promise<ModelCallContribution> => bound.contribute(callContext);
		};
		return {
			updates,
			bindTurn,
			setMode: (permissionMode: "default" | "plan") =>
				composition.invokeSync(CODING_AGENT_PERMISSION_MODE_SET, { permissionMode }),
			readState: () => composition.invokeSync(CODING_AGENT_PLAN_MODE_STATE_READ, undefined),
			runtime: composition.services.require(CODING_AGENT_PLAN_MODE_RUNTIME),
		};
	}

	async function submit(contribution: ModelCallContribution, plan: string) {
		const tool = contribution.tools?.[0];
		if (!tool) throw new Error("Expected exit_plan_mode to be offered");
		return tool.execute({ sessionId: "session-1", turnId: "turn-1", toolCallId: "call-1", input: { plan }, signal });
	}

	it("walks the plan → review → approve flow and reopens the tool surface inside the same turn", async () => {
		const review = vi.fn(
			async (): Promise<CodingAgentPlanReviewResult> => ({
				decision: "approve",
				plan: "1. Edited by the user",
			}),
		);
		const session = await createSession({ review, todo: true });

		expect((await (await session.bindTurn())()).instructions).toBeUndefined();

		expect(session.setMode("plan")).toEqual({ permissionMode: "plan" });
		const contribute = await session.bindTurn();
		const planning = await contribute();
		expect(planning.instructions?.[0]?.content).toContain("Plan mode is active");
		// 先补齐信息差、再列计划：澄清步骤必须排在设计与提交之前。
		const guidance = planning.instructions?.[0]?.content ?? "";
		expect(guidance.indexOf("Close the gaps with the user")).toBeGreaterThan(guidance.indexOf("Explore first"));
		expect(guidance.indexOf("Design the approach")).toBeGreaterThan(guidance.indexOf("Close the gaps with the user"));
		expect(guidance).toContain("Do not interrogate");
		// 澄清的收尾由「是否还有会改变计划的未决项」决定，不写死轮数
		expect(guidance).toContain("There is no fixed number of rounds");
		expect(guidance).not.toContain("ONE round");
		expect(guidance).toContain("the defaults you assumed");
		expect(planning.tools?.map(({ name }) => name)).toEqual(["exit_plan_mode"]);

		const result = await submit(planning, "1. Draft step");
		expect(review).toHaveBeenCalledWith("1. Draft step");
		expect(result.details).toEqual({ decision: "approve", plan: "1. Edited by the user" });
		const text = result.content[0]?.type === "text" ? result.content[0].text : "";
		expect(text).toContain("<approved_plan>\n1. Edited by the user\n</approved_plan>");
		expect(text).toContain("The user edited the plan");
		expect(text).toContain("todo tool");

		expect(session.readState()).toMatchObject({
			permissionMode: "default",
			plan: { content: "1. Edited by the user", status: "approved" },
		});
		expect(session.runtime.readPermissionMode()).toBe("default");
		// 同一 Turn 的下一次模型调用就不再受闸门约束，模型可以立刻开始执行。
		expect(await contribute()).toEqual({});
		expect(session.updates.map(({ permissionMode, plan }) => [permissionMode, plan?.status])).toEqual([
			["plan", undefined],
			["plan", "pending-review"],
			["default", "approved"],
		]);
	});

	it("keeps the gate closed when the user asks for changes or dismisses the review", async () => {
		const decisions: CodingAgentPlanReviewResult[] = [
			{ decision: "revise", feedback: "Step 2: keep the old API" },
			{ decision: "cancelled" },
		];
		const session = await createSession({ review: async () => decisions.shift()! });
		session.setMode("plan");
		const contribute = await session.bindTurn();

		const revised = await submit(await contribute(), "1. A\n2. B");
		expect(revised.details).toEqual({ decision: "revise" });
		expect(revised.content[0]).toMatchObject({ text: expect.stringContaining("Step 2: keep the old API") });
		expect(session.readState()).toMatchObject({ permissionMode: "plan", plan: { status: "changes-requested" } });

		const dismissed = await submit(await contribute(), "1. A\n2. B'");
		expect(dismissed.details).toEqual({ decision: "cancelled" });
		expect(session.readState()).toMatchObject({ permissionMode: "plan", plan: { status: "dismissed" } });
		expect((await contribute()).tools?.[0]?.name).toBe("exit_plan_mode");
	});

	it("does not leave a plan pending when the review is interrupted", async () => {
		const session = await createSession({
			review: async () => {
				throw new Error("aborted");
			},
		});
		session.setMode("plan");
		await expect(submit(await (await session.bindTurn())(), "1. A")).rejects.toThrow("aborted");
		expect(session.readState()).toMatchObject({ permissionMode: "plan", plan: { status: "dismissed" } });
	});

	it("explains plan mode without offering exit_plan_mode when the host cannot review plans", async () => {
		const session = await createSession();
		session.setMode("plan");
		const contribution = await (await session.bindTurn())();
		expect(contribution.tools).toBeUndefined();
		expect(contribution.instructions?.[0]?.content).toContain("**Present the complete plan** as your reply");
	});

	it("applies a tightening toggle from the next turn but a relaxing toggle immediately", async () => {
		const session = await createSession({ review: async () => ({ decision: "cancelled" }) });
		const defaultTurn = await session.bindTurn();
		session.setMode("plan");
		expect(await defaultTurn()).toEqual({});

		const planTurn = await session.bindTurn();
		expect((await planTurn()).instructions).toHaveLength(1);
		session.setMode("default");
		expect(await planTurn()).toEqual({});
	});

	it("refuses plan mode where nobody can approve a plan, and rejects unknown modes", async () => {
		const session = await createSession({ scenario: "batch" });
		expect(() => session.setMode("plan")).toThrow("unavailable in the batch scenario");
		expect(() => session.setMode("bypassPermissions" as never)).toThrow("Unknown permission mode");
		expect(session.readState()).toEqual({ permissionMode: "default" });
	});
});

describe("CodingAgentPlanModeRuntime persistence", () => {
	function createPersistedRuntime(initial: ConversationDocument) {
		let document = initial;
		let entry = 0;
		const runtime = new CodingAgentPlanModeRuntime({ createEntryId: () => `plan-${++entry}`, now: () => 1 });
		runtime.initialize(document, {
			appendCustomEntry: async (customEntry) => {
				document = applyConversationDocumentCommand(document, { type: "custom.append", ...customEntry }).document;
				runtime.onDocumentChanged(document);
			},
		});
		return { runtime, readDocument: () => document };
	}

	it("persists mode changes and restores them for a resumed session", async () => {
		const first = createPersistedRuntime(createEmptyConversationDocument({ sessionId: "s", createdAt: 1 }));
		first.runtime.setPermissionMode("plan");
		await first.runtime.dispose();
		expect(first.readDocument().entries.at(-1)).toMatchObject({
			type: "custom",
			customType: "plan_mode_snapshot",
			data: { permissionMode: "plan" },
		});

		const resumed = createPersistedRuntime(first.readDocument());
		expect(resumed.runtime.readPermissionMode()).toBe("plan");
	});

	it("defers persistence during a turn so an in-flight approval is not rolled back", async () => {
		const { runtime, readDocument } = createPersistedRuntime(
			createEmptyConversationDocument({ sessionId: "s", createdAt: 1 }),
		);
		runtime.setPermissionMode("plan");
		await runtime.onSessionEvent({ type: "turn.started" } as never);
		runtime.approvePlan("1. Ship");
		const entriesDuringTurn = readDocument().entries.length;
		runtime.onDocumentChanged(readDocument());
		expect(runtime.readPermissionMode()).toBe("default");

		await runtime.onSessionEvent({ type: "turn.completed" } as never);
		expect(readDocument().entries.length).toBe(entriesDuringTurn + 1);
		expect(readDocument().entries.at(-1)).toMatchObject({
			data: { permissionMode: "default", plan: { status: "approved" } },
		});
	});

	it("rejects malformed persisted snapshots at the storage boundary", () => {
		const malformed = applyConversationDocumentCommand(
			createEmptyConversationDocument({ sessionId: "s", createdAt: 1 }),
			{
				type: "custom.append",
				entryId: "bad",
				customType: "plan_mode_snapshot",
				data: { permissionMode: "yolo" },
				timestamp: new Date(1).toISOString(),
			},
		).document;
		const runtime = new CodingAgentPlanModeRuntime({ createEntryId: () => "x", now: () => 1 });
		expect(() => runtime.initialize(malformed, { appendCustomEntry: async () => undefined })).toThrow(
			"Invalid plan_mode_snapshot entry: bad",
		);
	});
});

describe("plan mode observation contract", () => {
	it("accepts well-formed observations and ignores everything else", () => {
		const payload = { permissionMode: "plan", plan: { content: "1. A", status: "pending-review", updatedAt: "t" } };
		const event = { type: "session.extension", extensionId: "coding-agent.plan-mode", event: "changed", payload };
		expect(readCodingAgentPlanModeObservation(event as never)).toEqual(payload);
		expect(readCodingAgentPlanModeObservation({ ...event, event: "other" } as never)).toBeUndefined();
		expect(
			readCodingAgentPlanModeObservation({ ...event, payload: { permissionMode: "root" } } as never),
		).toBeUndefined();
	});
});
