import { afterEach, describe, expect, it } from "vitest";
import {
	type BackgroundCommandService,
	type BackgroundCommandSnapshot,
	createBackgroundCommandService,
	createBackgroundCommandToolExecutor,
	createBashToolRegistration,
	createForegroundCommandToolExecutor,
	createShellToolRegistration,
} from "../../../src/coding/index.js";
import { createTestBackgroundCommandHost, createTestForegroundCommandHost } from "../../support/local-command-host.js";

type CommandName = "bash" | "shell";

const services: BackgroundCommandService[] = [];

afterEach(async () => {
	for (const service of services) service.dispose();
	await new Promise((resolve) => setTimeout(resolve, 50));
	services.length = 0;
});

function createRuntimeBackgroundService(): BackgroundCommandService {
	const service = createBackgroundCommandService(createTestBackgroundCommandHost());
	services.push(service);
	return service;
}

function createRuntimeCommandTool(
	name: CommandName,
	blockUntilSec: number,
	onNotification?: (task: BackgroundCommandSnapshot) => void,
) {
	const host = createTestForegroundCommandHost(process.cwd());
	const backgroundService = createRuntimeBackgroundService();
	if (onNotification) backgroundService.subscribeNotifications(onNotification);
	const foregroundExecutor = createForegroundCommandToolExecutor({ ...host, blockUntilSec });
	const executor = createBackgroundCommandToolExecutor({
		...host,
		backgroundService,
		foregroundExecutor,
		blockUntilSec,
	});
	return {
		backgroundService,
		tool:
			name === "bash"
				? createBashToolRegistration(process.cwd(), { executor }).tool
				: createShellToolRegistration(process.cwd(), { executor }).tool,
	};
}

function runtimeRequest(input: { command: string; timeout?: number; run_in_background?: boolean }) {
	return {
		sessionId: "session-1",
		turnId: "turn-1",
		toolCallId: "tool-call-1",
		input,
		signal: new AbortController().signal,
	};
}

function localNodeCommand(script: string): string {
	const executable = `"${process.execPath}"`;
	return `${executable} -e "${script}"`;
}

async function waitForCompletion(service: BackgroundCommandService, taskId: string): Promise<void> {
	const result = await service.wait(taskId, { maxMs: 10_000 });
	expect(result.stillRunning).toBe(false);
	await new Promise((resolve) => setTimeout(resolve, 20));
}

describe.each(["bash", "shell"] as const)("runtime %s background command", (toolName) => {
	it("runs explicitly in the background and emits one completion notification", async () => {
		const notifications: BackgroundCommandSnapshot[] = [];
		const runtime = createRuntimeCommandTool(toolName, 5, (task) => notifications.push(task));
		const result = await runtime.tool.execute(
			runtimeRequest({
				command: localNodeCommand("process.stdout.write('background-ok')"),
				run_in_background: true,
			}),
		);

		expect(result.content[0]).toMatchObject({
			text: expect.stringContaining("Command running in background with task ID: b1"),
		});
		expect(result.details).toMatchObject({ backgroundTaskId: "b1" });
		await waitForCompletion(runtime.backgroundService, "b1");
		expect(notifications).toHaveLength(1);
		expect(notifications[0]).toMatchObject({ id: "b1", status: "completed", exitCode: 0, tail: "background-ok" });
	});

	it("returns quick output inline and auto-promotes a long command", async () => {
		const quickNotifications: BackgroundCommandSnapshot[] = [];
		const quick = createRuntimeCommandTool(toolName, 5, (task) => quickNotifications.push(task));
		const quickResult = await quick.tool.execute(
			runtimeRequest({ command: localNodeCommand("process.stdout.write('inline-ok')") }),
		);
		expect(quickResult.content).toEqual([{ type: "text", text: "inline-ok" }]);
		expect(quickNotifications).toEqual([]);

		const promotedNotifications: BackgroundCommandSnapshot[] = [];
		const promoted = createRuntimeCommandTool(toolName, 0.05, (task) => promotedNotifications.push(task));
		const promotedResult = await promoted.tool.execute({
			...runtimeRequest({ command: localNodeCommand("setTimeout(() => {}, 300)") }),
		});
		expect(promotedResult.content[0]).toMatchObject({ text: expect.stringContaining("auto-promoted") });
		expect(promotedResult.details).toMatchObject({ backgroundTaskId: "b1", autoPromoted: true });
		expect(promoted.backgroundService.get("b1")?.status).toBe("running");
		await waitForCompletion(promoted.backgroundService, "b1");
		expect(promotedNotifications).toHaveLength(1);
	});

	it("preserves failure and truncation behavior", async () => {
		const failing = createRuntimeCommandTool(toolName, 5);
		await expect(
			failing.tool.execute(
				runtimeRequest({ command: localNodeCommand("process.stderr.write('background-failure');process.exit(2)") }),
			),
		).rejects.toThrow("background-failure");

		const truncating = createRuntimeCommandTool(toolName, 5);
		const result = await truncating.tool.execute(
			runtimeRequest({
				command: localNodeCommand("process.stdout.write(Array.from({length:2002},(_,i)=>'line-'+i).join('\\n'))"),
			}),
		);
		expect(result.details).toMatchObject({ truncation: { truncated: true, truncatedBy: "lines" } });
		expect(result.content[0]).toMatchObject({ text: expect.stringContaining("line-2001") });
	});
});
