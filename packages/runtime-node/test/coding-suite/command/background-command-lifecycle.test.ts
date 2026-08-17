import { describe, expect, it, vi } from "vitest";
import {
	type BackgroundCommandOutput,
	type BackgroundCommandOutputStore,
	type BackgroundCommandProcessOperations,
	createBackgroundCommandService,
	type SpawnBackgroundCommandProcessOptions,
} from "../../../src/coding/index.js";

class MemoryOutputStore implements BackgroundCommandOutputStore {
	readonly content = new Map<string, string>();
	readonly closed = new Set<string>();

	create(taskId: string): BackgroundCommandOutput {
		const path = `memory://${taskId}`;
		this.content.set(path, "");
		return {
			path,
			append: (text) => this.content.set(path, `${this.content.get(path) ?? ""}${text}`),
			read: (offset) =>
				Buffer.from(this.content.get(path) ?? "", "utf-8")
					.subarray(offset)
					.toString("utf-8"),
			close: () => {
				this.closed.add(path);
			},
		};
	}
}

class ControlledProcessOperations implements BackgroundCommandProcessOperations {
	readonly processes = new Map<string, SpawnBackgroundCommandProcessOptions>();

	spawn(options: SpawnBackgroundCommandProcessOptions) {
		this.processes.set(options.command, options);
		return {
			stop: () => options.onExit(undefined),
		};
	}

	output(command: string, text: string): void {
		this.get(command).onOutput(text);
	}

	exit(command: string, exitCode: number): void {
		this.get(command).onExit(exitCode);
	}

	fail(command: string, message: string): void {
		this.get(command).onError(new Error(message));
	}

	private get(command: string): SpawnBackgroundCommandProcessOptions {
		const process = this.processes.get(command);
		if (!process) throw new Error(`Process not found: ${command}`);
		return process;
	}
}

class DeferredStopProcessOperations implements BackgroundCommandProcessOperations {
	readonly processes = new Map<string, SpawnBackgroundCommandProcessOptions>();
	readonly stopped = new Set<string>();

	spawn(options: SpawnBackgroundCommandProcessOptions) {
		this.processes.set(options.command, options);
		return {
			stop: () => {
				this.stopped.add(options.command);
			},
		};
	}

	exitStopped(command: string): void {
		const process = this.processes.get(command);
		if (!process) throw new Error(`Process not found: ${command}`);
		process.onExit(undefined);
	}
}

function createControlledService() {
	const processOperations = new ControlledProcessOperations();
	const outputStore = new MemoryOutputStore();
	const service = createBackgroundCommandService({ processOperations, outputStore });
	return { outputStore, processOperations, service };
}

describe("background command lifecycle", () => {
	it("owns snapshots, output cursors, terminal events, and completion notifications", async () => {
		const { outputStore, processOperations, service } = createControlledService();
		const events: string[] = [];
		const notifications: string[] = [];
		service.subscribe((event) => events.push(event.type));
		service.subscribeNotifications((task) => notifications.push(task.id));

		const task = service.spawn({ command: "success", cwd: "C:/workspace", env: {} });
		processOperations.output("success", "first");
		expect(service.readOutput(task.id, { fromStart: true, advanceCursor: true })).toBe("first");
		processOperations.output("success", "-second");
		expect(service.readOutput(task.id, { fromStart: false, advanceCursor: true })).toBe("-second");
		processOperations.exit("success", 0);

		const waited = await service.wait(task.id, { maxMs: 1 });
		expect(waited).toMatchObject({ stillRunning: false, snapshot: { status: "completed", exitCode: 0 } });
		expect(events).toEqual(["task_started", "task_ended"]);
		expect(notifications).toEqual(["b1"]);
		expect(outputStore.closed).toContain("memory://b1");
	});

	it("suppresses inline notifications and enables them only after soft-timeout promotion", async () => {
		const inline = createControlledService();
		const inlineNotifications: string[] = [];
		inline.service.subscribeNotifications((task) => inlineNotifications.push(task.id));
		inline.service.spawn({
			command: "inline",
			cwd: "C:/workspace",
			env: {},
			notifyOnlyIfPromoted: true,
		});
		inline.processOperations.exit("inline", 0);
		expect(inlineNotifications).toEqual([]);

		const promoted = createControlledService();
		const promotedNotifications: string[] = [];
		promoted.service.subscribeNotifications((task) => promotedNotifications.push(task.id));
		const task = promoted.service.spawn({
			command: "promoted",
			cwd: "C:/workspace",
			env: {},
			notifyOnlyIfPromoted: true,
		});
		await expect(promoted.service.wait(task.id, { maxMs: 0 })).resolves.toMatchObject({ stillRunning: true });
		promoted.processOperations.exit("promoted", 0);
		expect(promotedNotifications).toEqual(["b1"]);
	});

	it("records stop reasons, maps process failures, and disposes running tasks", async () => {
		const { processOperations, service } = createControlledService();
		const stopped = service.spawn({ command: "stopped", cwd: "C:/workspace", env: {} });
		expect(service.stop(stopped.id, "user")).toBe(true);
		expect(service.get(stopped.id)).toMatchObject({ status: "killed", endedBy: "user" });
		expect(service.stop(stopped.id, "agent")).toBe(false);

		const failed = service.spawn({ command: "failed", cwd: "C:/workspace", env: {} });
		processOperations.fail("failed", "host failure");
		expect(service.get(failed.id)).toMatchObject({ status: "failed", exitCode: undefined });
		expect(service.readOutput(failed.id, { fromStart: true, advanceCursor: false })).toContain(
			"Failed to spawn command: host failure",
		);

		const disposed = service.spawn({ command: "disposed", cwd: "C:/workspace", env: {} });
		service.dispose();
		expect(service.get(disposed.id)).toMatchObject({ status: "killed", endedBy: "dispose" });
		await expect(service.wait("missing", { maxMs: 1 })).rejects.toThrow('Background task "missing" not found.');
	});

	it("awaits running process exits during shutdown", async () => {
		const processOperations = new DeferredStopProcessOperations();
		const service = createBackgroundCommandService({ processOperations, outputStore: new MemoryOutputStore() });
		const task = service.spawn({ command: "deferred", cwd: "C:/workspace", env: {} });
		let settled = false;
		const shutdown = service.shutdown().then(() => {
			settled = true;
		});

		await Promise.resolve();
		expect(processOperations.stopped).toContain("deferred");
		expect(settled).toBe(false);
		processOperations.exitStopped("deferred");
		await shutdown;

		expect(settled).toBe(true);
		expect(service.get(task.id)).toMatchObject({ status: "killed", endedBy: "dispose" });
	});

	it("lists copied snapshots and clears only terminal tasks", () => {
		const { processOperations, service } = createControlledService();
		const events: string[] = [];
		service.subscribe((event) => events.push(event.type));
		const running = service.spawn({ command: "running", cwd: "C:/workspace", env: {} });
		const completed = service.spawn({ command: "completed", cwd: "C:/workspace", env: {} });
		processOperations.exit("completed", 0);

		const snapshots = service.list();
		expect(snapshots.map(({ id }) => id)).toEqual([running.id, completed.id]);
		expect(snapshots[0]).not.toBe(service.get(running.id));
		expect(service.clearFinished()).toBe(1);
		expect(service.list().map(({ id }) => id)).toEqual([running.id]);
		expect(service.clearFinished()).toBe(0);
		expect(events.at(-1)).toBe("tasks_cleared");
	});

	it("isolates event and notification observers", () => {
		const { processOperations, service } = createControlledService();
		const events: string[] = [];
		const notifications: string[] = [];
		const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		service.subscribe(() => {
			throw new Error("event observer failed");
		});
		service.subscribe((event) => events.push(event.type));
		service.subscribeNotifications(() => {
			throw new Error("notification observer failed");
		});
		service.subscribeNotifications((task) => notifications.push(task.id));

		const task = service.spawn({ command: "observed", cwd: "C:/workspace", env: {} });
		processOperations.exit("observed", 0);

		expect(events).toEqual(["task_started", "task_ended"]);
		expect(notifications).toEqual([task.id]);
		expect(warning).toHaveBeenCalledTimes(3);
		warning.mockRestore();
	});
});
