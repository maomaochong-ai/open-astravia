import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSshHelperForTests, createLoopbackSshConnection } from "@vetta/ssh-transport/testing";
import { describe, expect, it, vi } from "vitest";
import { createSshBackgroundCommandHost } from "./ssh-background-command-host.js";

const helperBinary = buildSshHelperForTests();

function start(connection: ReturnType<typeof createLoopbackSshConnection>, command: string) {
	const output: string[] = [];
	const onExit = vi.fn();
	const onError = vi.fn();
	const process = createSshBackgroundCommandHost(connection).processOperations.spawn({
		command,
		cwd: realpathSync(mkdtempSync(join(tmpdir(), "vetta-remote-task-"))),
		env: {},
		onOutput: (text) => output.push(text),
		onExit,
		onError,
	});
	return { process, output, onExit, onError };
}

describe("远端后台任务：没有 helper 时绑在 SSH 通道上", () => {
	it("输出与退出码照常回来，停止时不报错", async () => {
		const finished = start(createLoopbackSshConnection(), "echo hello; exit 2");
		await vi.waitFor(() => expect(finished.onExit).toHaveBeenCalledWith(2), { timeout: 10_000 });
		expect(finished.output.join("")).toBe("hello\n");

		const stopped = start(createLoopbackSshConnection(), "echo up; sleep 60");
		await vi.waitFor(() => expect(stopped.output.join("")).toBe("up\n"), { timeout: 10_000 });
		stopped.process.stop();
		await vi.waitFor(() => expect(stopped.onExit).toHaveBeenCalledWith(undefined), { timeout: 10_000 });
		expect(stopped.onError).not.toHaveBeenCalled();
	});
});

describe.skipIf(!helperBinary)("远端后台任务：由 helper 托管", () => {
	const connect = () => createLoopbackSshConnection("loopback", { helper: { resolveBinary: () => helperBinary } });

	it("输出与退出码照常回来", async () => {
		const task = start(connect(), "echo hello; exit 2");
		await vi.waitFor(() => expect(task.onExit).toHaveBeenCalledWith(2), { timeout: 15_000 });
		expect(task.output.join("")).toBe("hello\n");
		expect(task.onError).not.toHaveBeenCalled();
	});

	it("连接中途断开，任务继续跑，重连后输出一行不少", async () => {
		const connection = connect();
		const task = start(connection, "echo before; sleep 1; echo after; exit 0");
		await vi.waitFor(() => expect(task.output.join("")).toBe("before\n"), { timeout: 15_000 });

		// 网络断了：helper 的通道被掐掉。任务是远端一个独立的会话，不受影响。
		(await connection.helper())?.close();

		await vi.waitFor(() => expect(task.onExit).toHaveBeenCalledWith(0), { timeout: 20_000 });
		expect(task.output.join("")).toBe("before\nafter\n");
		expect(task.onError).not.toHaveBeenCalled();
	});

	it("停止会结束远端的整棵进程树", async () => {
		const connection = connect();
		const task = start(connection, "echo up; sleep 60");
		await vi.waitFor(() => expect(task.output.join("")).toBe("up\n"), { timeout: 15_000 });

		task.process.stop();

		expect(task.onExit).toHaveBeenCalledWith(undefined);
		const helper = await connection.helper();
		await vi.waitFor(
			async () => {
				const { tasks } = (await helper?.call<{ tasks: { state: string }[] }>("proc.list")) ?? { tasks: [] };
				expect(tasks.filter((item) => item.state === "live")).toEqual([]);
			},
			{ timeout: 15_000 },
		);
	});
});
