import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type {
	SubagentCoordinatorPort,
	SubagentSnapshot,
	SubagentSpawnRequest,
	SubagentWaitResult,
} from "@vetta/runtime-subagents";
import { describe, expect, it, vi } from "vitest";
import {
	createDispatchWorkflowsToolRegistration,
	createFollowupTaskToolRegistration,
	createInterruptAgentToolRegistration,
	createListAgentsToolRegistration,
	createSendMessageToolRegistration,
	createSpawnAgentToolRegistration,
	createWaitAgentToolRegistration,
	DISPATCH_WORKFLOWS_MAX_BATCH,
	WORKFLOW_NO_WAIT_TEXT,
} from "../../src/coding/index.js";

describe("subagent control runtime tools", () => {
	it("preserves the seven tool names, scopes, categories, schemas and stable order", () => {
		const fixture = createCoordinatorFixture();
		const registrations = createRegistrations(fixture.port);

		expect(registrations.map(({ tool }) => tool.name)).toEqual([
			"spawn_agent",
			"dispatch_workflows",
			"wait_agent",
			"list_agents",
			"interrupt_agent",
			"send_message",
			"followup_task",
		]);
		expect(registrations.map(({ tool }) => tool.label)).toEqual(registrations.map(({ tool }) => tool.name));
		expect(registrations.map(({ modelOrder }) => modelOrder)).toEqual([2500, 2600, 2700, 2800, 2900, 3000, 3100]);
		for (const registration of registrations) {
			expect(registration.scopeUse).toEqual(["conversation", "project", "cli"]);
			expect(registration.category).toBe("agent-control");
			expect(registration.tool.description.length).toBeGreaterThan(20);
			expect(registration.tool.inputSchema).toMatchObject({ type: "object" });
			expect(registration.tool.modelOrder).toBe(registration.modelOrder);
		}
		expect(registrations[1].tool.inputSchema).toMatchObject({
			properties: {
				workflows: { minItems: 1, maxItems: DISPATCH_WORKFLOWS_MAX_BATCH },
			},
		});
	});

	it("fails closed when the session has no coordinator", async () => {
		const registration = createSpawnAgentToolRegistration({
			getCoordinator: () => undefined,
		});

		await expect(
			execute(registration.tool, {
				task_name: "inspect",
				message: "inspect the runtime",
				agent_type: "explorer",
			}),
		).rejects.toThrow("Subagents are not enabled for this session.");
	});

	it("spawns and dispatches through the coordinator port without changing results", async () => {
		const fixture = createCoordinatorFixture();
		const [spawn, dispatch] = createRegistrations(fixture.port);

		const spawnResult = await execute(spawn.tool, {
			task_name: "inspect",
			message: "inspect the runtime",
			agent_type: "explorer",
		});
		expect(fixture.spawn).toHaveBeenCalledWith({
			taskName: "inspect",
			message: "inspect the runtime",
			agentType: "explorer",
		});
		expect(spawnResult.content).toEqual([
			{
				type: "text",
				text: [
					"Spawned subagent child-1",
					"path: /root/inspect",
					"type: explorer",
					"status: running",
					"task_name: inspect",
					"Use wait_agent to join, or continue and handle <subagent_notification>.",
				].join("\n"),
			},
		]);

		const dispatchResult = await execute(dispatch.tool, {
			workflows: [
				{
					task_name: "refactor_api",
					title: "Refactor API",
					message: "refactor the API",
					todos: ["inspect", "change"],
				},
			],
		});
		expect(fixture.spawnMany).toHaveBeenCalledWith([
			{
				taskName: "refactor_api",
				title: "Refactor API",
				message: "refactor the API",
				agentType: "workflow",
				todos: ["inspect", "change"],
			},
		]);
		expect(dispatchResult.content).toEqual([
			{
				type: "text",
				text: [
					"Dispatched 1 workflow(s):",
					"- refactor_api [queued] id: workflow-1 todos: 0/2",
					"You will receive <subagent_notification> as each workflow reaches a terminal state. Do NOT call wait_agent — end your turn (or continue other work) and handle the notifications passively.",
				].join("\n"),
			},
		]);
	});

	it("lists, interrupts, messages and follows up through the coordinator port", async () => {
		const fixture = createCoordinatorFixture();
		const registrations = createRegistrations(fixture.port);
		fixture.listed = [snapshot("inspect", "explorer", "running")];

		const listResult = await execute(registrations[3].tool, {});
		expect(listResult.content).toEqual([
			{
				type: "text",
				text: 'Registered types: explorer, workflow\nAgents:\n- /root/inspect id=child-1 type=explorer status=running task="task inspect"',
			},
		]);

		const interruptResult = await execute(registrations[4].tool, { target: "inspect" });
		expect(fixture.interrupt).toHaveBeenCalledWith("inspect");
		expect(interruptResult.content).toEqual([
			{ type: "text", text: "Subagent child-1 (/root/inspect) status=interrupted" },
		]);

		const messageResult = await execute(registrations[5].tool, {
			target: "inspect",
			message: "focus on contracts",
		});
		expect(fixture.sendMessage).toHaveBeenCalledWith("inspect", "focus on contracts");
		expect(messageResult.content).toEqual([{ type: "text", text: "Message queued for child-1 (/root/inspect)." }]);

		const followupResult = await execute(registrations[6].tool, {
			target: "inspect",
			message: "continue",
		});
		expect(fixture.followUp).toHaveBeenCalledWith("inspect", "continue");
		expect(followupResult.content).toEqual([
			{ type: "text", text: "Follow-up dispatched to child-1 (/root/inspect), status=running" },
		]);
	});

	it("caps workflow-only waits and preserves terminal result formatting", async () => {
		const fixture = createCoordinatorFixture();
		const wait = createRegistrations(fixture.port)[2];
		fixture.listed = [snapshot("flow", "workflow", "running")];
		fixture.waitResult = { timedOut: true, agents: [] };

		const guardedResult = await execute(wait.tool, { timeout_ms: 99_000 });
		expect(fixture.wait).toHaveBeenCalledWith({ targets: undefined, timeoutMs: 1000 });
		expect(guardedResult).toEqual({
			content: [{ type: "text", text: WORKFLOW_NO_WAIT_TEXT }],
			details: { timedOut: true, agents: [], workflowNoWait: true },
		});

		fixture.listed = [snapshot("inspect", "explorer", "running")];
		fixture.waitResult = {
			timedOut: false,
			agents: [{ ...snapshot("inspect", "explorer", "completed"), finalText: "done" }],
		};
		const terminalResult = await execute(wait.tool, { targets: ["inspect"], timeout_ms: 5_000 });
		expect(fixture.wait).toHaveBeenLastCalledWith({ targets: ["inspect"], timeoutMs: 5_000 });
		expect(terminalResult.content).toEqual([
			{
				type: "text",
				text: "wait_agent results:\n\nid=child-1 path=/root/inspect type=explorer status=completed \nsummary:\ndone",
			},
		]);
	});
});

function createRegistrations(port: SubagentCoordinatorPort) {
	const getCoordinator = () => port;
	return [
		createSpawnAgentToolRegistration({ getCoordinator, modelOrder: 2500 }),
		createDispatchWorkflowsToolRegistration({ getCoordinator, workflowTypeId: "workflow", modelOrder: 2600 }),
		createWaitAgentToolRegistration({ getCoordinator, workflowTypeId: "workflow", modelOrder: 2700 }),
		createListAgentsToolRegistration({ getCoordinator, modelOrder: 2800 }),
		createInterruptAgentToolRegistration({ getCoordinator, modelOrder: 2900 }),
		createSendMessageToolRegistration({ getCoordinator, modelOrder: 3000 }),
		createFollowupTaskToolRegistration({ getCoordinator, modelOrder: 3100 }),
	] as const;
}

function createCoordinatorFixture() {
	const spawn = vi.fn(async (request: SubagentSpawnRequest) =>
		snapshot(request.taskName, request.agentType, "running"),
	);
	const spawnMany = vi.fn((requests: readonly SubagentSpawnRequest[]) =>
		requests.map((request) => ({
			...snapshot(request.taskName, request.agentType, "queued"),
			id: "workflow-1",
			todoProgress: request.todos ? { done: 0, total: request.todos.length } : undefined,
		})),
	);
	const interrupt = vi.fn((target: string) => ({ ...snapshot(target, "explorer", "interrupted") }));
	const sendMessage = vi.fn(async (target: string) => snapshot(target, "explorer", "running"));
	const followUp = vi.fn(async (target: string) => snapshot(target, "explorer", "running"));
	const wait = vi.fn(async (): Promise<SubagentWaitResult> => fixture.waitResult);
	const fixture: {
		listed: SubagentSnapshot[];
		waitResult: SubagentWaitResult;
		readonly spawn: typeof spawn;
		readonly spawnMany: typeof spawnMany;
		readonly interrupt: typeof interrupt;
		readonly sendMessage: typeof sendMessage;
		readonly followUp: typeof followUp;
		readonly wait: typeof wait;
		readonly port: SubagentCoordinatorPort;
	} = {
		listed: [],
		waitResult: { timedOut: false, agents: [] },
		spawn,
		spawnMany,
		interrupt,
		sendMessage,
		followUp,
		wait,
		port: {
			list: () => fixture.listed,
			get: (target) => fixture.listed.find((entry) => entry.id === target || entry.taskName === target),
			clearFinished: () => 0,
			registeredTypeIds: () => ["explorer", "workflow"],
			spawn,
			spawnMany,
			sendMessage,
			followUp,
			interrupt,
			wait,
			dispose: async () => {},
		},
	};
	return fixture;
}

function snapshot(taskName: string, agentType: string, status: SubagentSnapshot["status"]): SubagentSnapshot {
	return {
		id: "child-1",
		taskName,
		path: `/root/${taskName}`,
		agentType,
		status,
		task: `task ${taskName}`,
		parentSessionId: "parent-1",
		startedAt: 1,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costTotal: 0 },
		generation: 1,
	};
}

function execute<TInput extends object>(tool: RuntimeToolDefinition<TInput>, input: TInput) {
	return tool.execute({
		sessionId: "session-1",
		turnId: "turn-1",
		toolCallId: "tool-call-1",
		input,
		signal: new AbortController().signal,
	});
}
