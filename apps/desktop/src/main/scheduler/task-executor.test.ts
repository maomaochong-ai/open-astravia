import type { RuntimeHost, RuntimeTurnPromptOutcome } from "@vetta/runtime-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledTask, TaskExecutionRecord } from "../../shared/automation.js";

const CONVERSATION_CWD = "C:/home/.vetta/conversation";
const PROJECT_CWD = "C:/workspace/project";

const mocks = vi.hoisted(() => ({
	createSession: vi.fn(),
	openSession: vi.fn(),
	emitTaskEvent: vi.fn(),
	existing: new Set<string>(),
	notify: vi.fn(async () => undefined as string | undefined),
	projects: [] as Array<{ path: string }>,
	records: [] as TaskExecutionRecord[],
	updateTask: vi.fn(),
	updateTaskLastRun: vi.fn(async () => {}),
}));

vi.mock("node:fs", () => ({ existsSync: (path: string) => mocks.existing.has(path) }));
vi.mock("../app-monitor/app-monitor-service.js", () => ({ recordAutomationRunStarted: vi.fn() }));
vi.mock("../conversations/desktop-conversation-service.js", () => ({
	getDesktopConversationService: () => ({ createSession: mocks.createSession, openSession: mocks.openSession }),
}));
vi.mock("../conversations/session-paths.js", () => ({
	isConversationCwd: (cwd: string) => cwd === CONVERSATION_CWD,
}));
vi.mock("../i18n/index.js", () => ({ mainT: (key: string) => key }));
vi.mock("../ipc/fs.js", () => ({
	readDesktopConfig: async () => ({ projects: mocks.projects, archivedProjects: [], defaultExecutionMode: "sandbox" }),
}));
vi.mock("../ipc/scheduler.js", () => ({ emitTaskEvent: mocks.emitTaskEvent }));
vi.mock("../logger.js", () => ({ getAppLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }));
vi.mock("../models/model-settings-host.js", () => ({
	getDesktopModelSettingsService: () => ({ list: async () => ({ defaultModel: "default/model" }) }),
}));
vi.mock("../projects/project-path.js", () => ({ sameProjectPath: (a: string, b: string) => a === b }));
vi.mock("./automation-notifier.js", () => ({ notifyAutomationFinished: mocks.notify }));
vi.mock("./task-storage.js", () => ({
	generateId: () => `record-${mocks.records.length + 1}`,
	updateTask: mocks.updateTask,
	updateTaskLastRun: mocks.updateTaskLastRun,
	writeRecord: async (record: TaskExecutionRecord) => {
		mocks.records.push(record);
	},
}));

import { executeTask, isTaskRunning, shutdownSchedulerTaskExecutor } from "./task-executor.js";

interface FakeRuntimeOptions {
	readonly outcome?: RuntimeTurnPromptOutcome;
	readonly prompt?: () => Promise<RuntimeTurnPromptOutcome>;
	readonly executionMode?: "sandbox" | "full-access";
	readonly permissionMode?: "default" | "plan";
}

function fakeRuntime(options: FakeRuntimeOptions = {}) {
	const calls: string[] = [];
	let executionMode = options.executionMode ?? "full-access";
	let permissionMode = options.permissionMode;
	const runtime = {
		prompt: vi.fn(async () => {
			calls.push(`prompt:${executionMode}:${permissionMode ?? "none"}`);
			return options.prompt ? await options.prompt() : (options.outcome ?? { status: "completed", turnId: "t1" });
		}),
		abort: vi.fn(async () => {}),
		renameSessionById: vi.fn(async () => {}),
		getState: vi.fn(() => ({ isStreaming: false, executionMode })),
		setExecutionMode: vi.fn(async (_id: string, mode: "sandbox" | "full-access") => {
			executionMode = mode;
		}),
		invokeSessionExtensionSync: vi.fn(
			(_id: string, token: { endpoint?: string }, input?: { permissionMode: "default" | "plan" }) => {
				if (permissionMode === undefined) throw new Error("plan mode unavailable");
				if (input) permissionMode = input.permissionMode;
				void token;
				return { permissionMode };
			},
		),
		getMessages: vi.fn(() => [
			{ role: "user", content: "run" },
			{ role: "assistant", content: [{ type: "text", text: "all done" }] },
		]),
		subscribe: vi.fn(() => () => {}),
		getSessionPath: vi.fn(() => undefined),
	};
	return {
		runtime: runtime as unknown as RuntimeHost & typeof runtime,
		calls,
		state: () => ({ executionMode, permissionMode }),
	};
}

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
	return {
		id: "task-1",
		name: "Daily report",
		prompt: "Summarize today",
		schedule: { kind: "daily", hour: 9, minute: 0 },
		runTarget: { mode: "new-session", projectCwd: PROJECT_CWD },
		enabled: true,
		createdAt: 1,
		updatedAt: 1,
		lastRunAt: null,
		lastRunStatus: null,
		...overrides,
	};
}

function session(sessionPath = "C:/sessions/new.jsonl") {
	return { sessionId: "session-1", sessionPath, cwd: PROJECT_CWD, listCwd: PROJECT_CWD, source: "automation" };
}

describe("automation task executor", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.records.length = 0;
		mocks.existing.clear();
		mocks.projects = [{ path: PROJECT_CWD }];
		mocks.createSession.mockResolvedValue(session());
		mocks.openSession.mockResolvedValue(session("C:/sessions/bound.jsonl"));
		mocks.updateTask.mockImplementation(async (_id: string, update: (current: ScheduledTask) => ScheduledTask) =>
			update(task()),
		);
	});

	it("runs a new-session automation in the chosen project as an unattended work turn", async () => {
		const { runtime } = fakeRuntime();
		await executeTask(task(), runtime, { trigger: "schedule" });

		expect(mocks.createSession).toHaveBeenCalledWith(
			{ cwd: PROJECT_CWD, executionMode: "full-access", agentMode: "work", scenario: "automation" },
			"other",
			"automation",
		);
		expect(runtime.prompt).toHaveBeenCalledWith("session-1", {
			text: "Summarize today",
			modelKey: "default/model",
			metadata: { unattended: true, automationTaskId: "task-1" },
		});
		expect(mocks.emitTaskEvent).toHaveBeenCalledWith(
			expect.objectContaining({ type: "task.started", listCwd: PROJECT_CWD, mode: "new-session" }),
		);
		expect(mocks.records.at(-1)).toMatchObject({
			status: "success",
			sessionPath: "C:/sessions/new.jsonl",
			responsePreview: "all done",
			mode: "new-session",
		});
		expect(mocks.notify).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ status: "success" }),
			"all done",
		);
		expect(mocks.updateTaskLastRun).toHaveBeenCalledWith("task-1", "success");
		expect(isTaskRunning("task-1")).toBe(false);
	});

	it("records a failed turn as failed instead of success", async () => {
		const { runtime } = fakeRuntime({
			outcome: { status: "failed", turnId: "t1", error: { message: "provider down" } } as RuntimeTurnPromptOutcome,
		});
		await executeTask(task(), runtime, { trigger: "schedule" });

		expect(mocks.records.at(-1)).toMatchObject({ status: "failed", error: "provider down" });
		expect(mocks.updateTaskLastRun).toHaveBeenCalledWith("task-1", "failed");
	});

	it("passes the explicit model and reasoning and lifts the scene token into promptRef", async () => {
		const { runtime } = fakeRuntime();
		await executeTask(
			task({ prompt: "@scene:review check the diff", model: { key: "anthropic/opus", reasoning: "high" } }),
			runtime,
			{ trigger: "manual" },
		);

		expect(runtime.prompt).toHaveBeenCalledWith(
			"session-1",
			expect.objectContaining({
				text: "check the diff",
				promptRef: { kind: "scene", name: "review" },
				modelKey: "anthropic/opus",
				reasoning: "high",
			}),
		);
	});

	it("skips a scheduled trigger while the previous run is still going", async () => {
		let finish: (outcome: RuntimeTurnPromptOutcome) => void = () => {};
		const { runtime } = fakeRuntime({
			prompt: () =>
				new Promise<RuntimeTurnPromptOutcome>((resolve) => {
					finish = resolve;
				}),
		});
		const first = executeTask(task(), runtime, { trigger: "schedule" });
		await vi.waitFor(() => expect(runtime.prompt).toHaveBeenCalledOnce());

		await executeTask(task(), runtime, { trigger: "schedule" });
		await expect(executeTask(task(), runtime, { trigger: "manual" })).rejects.toThrow("already running");
		finish({ status: "completed", turnId: "t1" });
		await first;

		expect(mocks.records.filter((record) => record.status === "skipped")).toEqual([
			expect.objectContaining({ reason: "previous-running", completedAt: expect.any(Number) }),
		]);
		expect(runtime.prompt).toHaveBeenCalledOnce();
	});

	it("suspends instead of silently replacing a deleted bound session", async () => {
		const { runtime } = fakeRuntime();
		const onTaskChanged = vi.fn();
		await executeTask(
			task({ runTarget: { mode: "same-session", projectCwd: PROJECT_CWD, sessionPath: "C:/sessions/gone.jsonl" } }),
			runtime,
			{ trigger: "schedule", onTaskChanged },
		);

		expect(mocks.createSession).not.toHaveBeenCalled();
		expect(mocks.openSession).not.toHaveBeenCalled();
		expect(onTaskChanged).toHaveBeenCalledWith(
			expect.objectContaining({ enabled: false, suspendedReason: "session-deleted" }),
		);
		expect(mocks.records.at(-1)).toMatchObject({ status: "failed", error: "automation:suspended.session-deleted" });
	});

	it("suspends when the target project left the sidebar", async () => {
		mocks.projects = [];
		const { runtime } = fakeRuntime();
		const onTaskChanged = vi.fn();
		await executeTask(task(), runtime, { trigger: "schedule", onTaskChanged });

		expect(onTaskChanged).toHaveBeenCalledWith(expect.objectContaining({ suspendedReason: "project-removed" }));
		expect(runtime.prompt).not.toHaveBeenCalled();
	});

	it("creates the same-session conversation once and binds it after it lands on disk", async () => {
		mocks.existing.add("C:/sessions/new.jsonl");
		const { runtime } = fakeRuntime();
		const onTaskChanged = vi.fn();
		const sameSessionTask = task({
			runTarget: { mode: "same-session", projectCwd: CONVERSATION_CWD, sessionPath: null },
		});
		mocks.updateTask.mockImplementation(async (_id: string, update: (current: ScheduledTask) => ScheduledTask) =>
			update(sameSessionTask),
		);
		await executeTask(sameSessionTask, runtime, { trigger: "schedule", onTaskChanged });

		expect(mocks.createSession).toHaveBeenCalledWith(
			{ cwd: CONVERSATION_CWD, executionMode: "full-access", agentMode: "work" },
			"conversation",
			"automation",
		);
		expect(runtime.renameSessionById).toHaveBeenCalledWith("session-1", "Daily report");
		expect(onTaskChanged).toHaveBeenCalledWith(
			expect.objectContaining({ runTarget: expect.objectContaining({ sessionPath: "C:/sessions/new.jsonl" }) }),
		);
	});

	it("runs a bound session turn in full access outside plan mode and restores the session afterwards", async () => {
		mocks.existing.add("C:/sessions/bound.jsonl");
		const { runtime, calls, state } = fakeRuntime({ executionMode: "sandbox", permissionMode: "plan" });
		await executeTask(
			task({ runTarget: { mode: "same-session", projectCwd: PROJECT_CWD, sessionPath: "C:/sessions/bound.jsonl" } }),
			runtime,
			{ trigger: "schedule" },
		);

		expect(mocks.openSession).toHaveBeenCalledWith("C:/sessions/bound.jsonl", "sandbox", "automation");
		expect(runtime.renameSessionById).not.toHaveBeenCalled();
		expect(calls).toEqual(["prompt:full-access:default"]);
		expect(state()).toEqual({ executionMode: "sandbox", permissionMode: "plan" });
	});

	it("aborts active work and rejects work after shutdown", async () => {
		const { runtime } = fakeRuntime({
			prompt: () =>
				new Promise<RuntimeTurnPromptOutcome>((resolve) => {
					runtime.abort.mockImplementation(async () => resolve({ status: "cancelled" }));
				}),
		});
		const execution = executeTask(task(), runtime, { trigger: "schedule" });
		await vi.waitFor(() => expect(runtime.prompt).toHaveBeenCalledOnce());

		await Promise.all([shutdownSchedulerTaskExecutor(), shutdownSchedulerTaskExecutor(), execution]);

		expect(runtime.abort).toHaveBeenCalledOnce();
		expect(mocks.records.at(-1)).toMatchObject({ status: "aborted" });
		await expect(executeTask(task(), runtime, { trigger: "schedule" })).rejects.toThrow(
			"Scheduler task executor is shutting down",
		);
	});
});
