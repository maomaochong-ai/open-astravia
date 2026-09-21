import { describe, expect, it } from "vitest";
import { createNodeSshProcessRunner } from "./node-process-runner.js";

// 用 /bin/sh 顶替 ssh：被测的是子进程的输出、超时与中止处理，与对端是不是 ssh 无关。
const runner = createNodeSshProcessRunner({ sshBinary: "/bin/sh" });
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe("ssh 子进程执行器", () => {
	it("不流式消费时，完整输出在结果里", async () => {
		const result = await runner.run({ argv: ["-c", "printf abc; printf oops >&2; exit 3"] });
		expect(decode(result.stdout)).toBe("abc");
		expect(result.stderr).toBe("oops");
		expect(result.exitCode).toBe(3);
	});

	it("流式消费时不再另存一份——长驻任务的日志会让内存随运行时间无限增长", async () => {
		const chunks: string[] = [];
		const result = await runner.run({
			argv: ["-c", "printf abc"],
			onStdout: (chunk) => chunks.push(decode(chunk)),
		});
		expect(chunks.join("")).toBe("abc");
		expect(result.stdout.byteLength).toBe(0);
	});

	it("流式消费的 stderr 只留尾部，够做错误分类即可", async () => {
		const result = await runner.run({
			argv: ["-c", "i=0; while [ $i -lt 400 ]; do printf '%0100d' 0 >&2; i=$((i+1)); done; printf TAIL >&2"],
			onStderr: () => {},
		});
		expect(result.stderr.endsWith("TAIL")).toBe(true);
		expect(result.stderr.length).toBeLessThan(40_000);
	});

	it("超时与主动取消分得开", async () => {
		const timedOut = await runner.run({ argv: ["-c", "sleep 30"], timeoutMs: 50 });
		expect(timedOut).toMatchObject({ aborted: true, timedOut: true });

		const controller = new AbortController();
		const pending = runner.run({ argv: ["-c", "sleep 30"], signal: controller.signal });
		controller.abort();
		await expect(pending).resolves.toMatchObject({ aborted: true, timedOut: false });
	});
});
