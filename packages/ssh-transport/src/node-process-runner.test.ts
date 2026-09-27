import { describe, expect, it } from "vitest";
import { createNodeSshProcessRunner } from "./node-process-runner.js";

// 用当前 Node 顶替 ssh：被测的是子进程的输出、超时与中止处理，与对端是不是 ssh 无关。
const runner = createNodeSshProcessRunner({ sshBinary: process.execPath });
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe("ssh 子进程执行器", () => {
	it("不流式消费时，完整输出在结果里", async () => {
		const result = await runner.run({
			argv: ["-e", `process.stdout.write("abc"); process.stderr.write("oops"); process.exit(3)`],
		});
		expect(decode(result.stdout)).toBe("abc");
		expect(result.stderr).toBe("oops");
		expect(result.exitCode).toBe(3);
	});

	it("流式消费时不再另存一份——长驻任务的日志会让内存随运行时间无限增长", async () => {
		const chunks: string[] = [];
		const result = await runner.run({
			argv: ["-e", `process.stdout.write("abc")`],
			onStdout: (chunk) => chunks.push(decode(chunk)),
		});
		expect(chunks.join("")).toBe("abc");
		expect(result.stdout.byteLength).toBe(0);
	});

	it("流式消费的 stderr 只留尾部，够做错误分类即可", async () => {
		const result = await runner.run({
			argv: [
				"-e",
				`let i = 0; const write = () => { if (i++ < 400) { process.stderr.write("0".repeat(100)); setImmediate(write); } else process.stderr.write("TAIL"); }; write();`,
			],
			onStderr: () => {},
		});
		expect(result.stderr.endsWith("TAIL")).toBe(true);
		expect(result.stderr.length).toBeLessThan(40_000);
	});

	it("超时与主动取消分得开", async () => {
		const wait = ["-e", `setTimeout(() => {}, 30_000)`];
		const timedOut = await runner.run({ argv: wait, timeoutMs: 50 });
		expect(timedOut).toMatchObject({ aborted: true, timedOut: true });

		const controller = new AbortController();
		const pending = runner.run({ argv: wait, signal: controller.signal });
		controller.abort();
		await expect(pending).resolves.toMatchObject({ aborted: true, timedOut: false });
	});

	it.runIf(process.platform !== "win32")("取消时终止整个本地 SSH 进程组，孙进程不会继续占用输出管道", async () => {
		const posixRunner = createNodeSshProcessRunner({ sshBinary: "/bin/sh" });
		const controller = new AbortController();
		let reportDescendant: ((pid: number) => void) | undefined;
		const descendantStarted = new Promise<number>((resolve) => {
			reportDescendant = resolve;
		});
		const pending = posixRunner.run({
			argv: ["-c", `/bin/sh -c 'sleep 30 & p=$!; printf "%s\\n" "$p"; wait "$p"'`],
			signal: controller.signal,
			onStdout: (chunk) => reportDescendant?.(Number.parseInt(decode(chunk).trim(), 10)),
		});
		const descendantPid = await descendantStarted;

		controller.abort();
		const deadline = Symbol("deadline");
		let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
		try {
			const result = await Promise.race([
				pending,
				new Promise<typeof deadline>((resolve) => {
					deadlineTimer = setTimeout(() => resolve(deadline), 1000);
				}),
			]);
			expect(result).not.toBe(deadline);
			expect(result).toMatchObject({ aborted: true, timedOut: false });
		} finally {
			if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
			// 断言失败时也不把回归用的 sleep 留给测试 worker。
			try {
				process.kill(descendantPid, "SIGKILL");
			} catch {}
			await pending;
		}
	});
});
