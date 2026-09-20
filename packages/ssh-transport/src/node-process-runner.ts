import { spawn } from "node:child_process";
import type {
	SshChannelInvocation,
	SshProcessChannel,
	SshProcessInvocation,
	SshProcessResult,
	SshProcessRunner,
} from "./process-runner.js";

export interface NodeSshProcessRunnerOptions {
	/** `ssh` 可执行文件。默认用 PATH 里的 `ssh`。 */
	readonly sshBinary?: string;
	/** 基础环境。默认继承当前进程。 */
	readonly baseEnv?: NodeJS.ProcessEnv;
}

/**
 * 用系统 OpenSSH 二进制执行命令。
 *
 * 选系统 ssh 而不是 ssh2 这类纯 JS 实现：`~/.ssh/config` 的 Include、Match、
 * ProxyJump、ProxyCommand、IdentityAgent、FIDO 安全密钥、GSSAPI 全部由它原生支持。
 * 用户只要 `ssh host` 能连上，Vetta 就能连上；自己实现这套等于长期追着 OpenSSH 的
 * 行为打补丁。
 */
export function createNodeSshProcessRunner(options: NodeSshProcessRunnerOptions = {}): SshProcessRunner {
	const sshBinary = options.sshBinary ?? "ssh";
	return {
		run(invocation: SshProcessInvocation): Promise<SshProcessResult> {
			return runSshProcess(sshBinary, options.baseEnv ?? process.env, invocation);
		},
		open(invocation: SshChannelInvocation): SshProcessChannel {
			return openSshChannel(sshBinary, options.baseEnv ?? process.env, invocation);
		},
	};
}

function runSshProcess(
	sshBinary: string,
	baseEnv: NodeJS.ProcessEnv,
	invocation: SshProcessInvocation,
): Promise<SshProcessResult> {
	return new Promise((resolve, reject) => {
		if (invocation.signal?.aborted) {
			resolve({ exitCode: null, stdout: new Uint8Array(), stderr: "", aborted: true });
			return;
		}
		const child = spawn(sshBinary, [...invocation.argv], {
			env: { ...baseEnv, ...invocation.env },
			stdio: ["pipe", "pipe", "pipe"],
		});

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let aborted = false;
		let timedOut = false;
		let settled = false;

		const stop = (reason: "signal" | "timeout"): void => {
			if (settled || child.killed) return;
			aborted = true;
			timedOut = reason === "timeout";
			// 先 SIGTERM 让 ssh 有机会清理 master 连接；它不理会时再硬杀。
			child.kill("SIGTERM");
			setTimeout(() => {
				if (!settled) child.kill("SIGKILL");
			}, 2000).unref?.();
		};

		const timer =
			invocation.timeoutMs === undefined ? undefined : setTimeout(() => stop("timeout"), invocation.timeoutMs);
		timer?.unref?.();
		const onAbort = (): void => stop("signal");
		invocation.signal?.addEventListener("abort", onAbort, { once: true });

		child.stdout.on("data", (chunk: Buffer) => {
			if (invocation.onStdout) invocation.onStdout(chunk);
			else stdoutChunks.push(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			// stderr 只留尾部：错误分类只需要最后几行，而流式消费的长任务同样会写个不停。
			if (invocation.onStderr) {
				invocation.onStderr(chunk);
				keepTail(stderrChunks, chunk, STREAMED_STDERR_TAIL_BYTES);
			} else {
				stderrChunks.push(chunk);
			}
		});

		const finish = (exitCode: number | null): void => {
			if (settled) return;
			settled = true;
			if (timer !== undefined) clearTimeout(timer);
			invocation.signal?.removeEventListener("abort", onAbort);
			resolve({
				exitCode,
				stdout: Buffer.concat(stdoutChunks),
				stderr: Buffer.concat(stderrChunks).toString("utf8"),
				aborted,
				timedOut,
			});
		};

		child.on("error", (error) => {
			if (settled) return;
			settled = true;
			if (timer !== undefined) clearTimeout(timer);
			invocation.signal?.removeEventListener("abort", onAbort);
			reject(error);
		});
		// 用 close 而不是 exit：exit 可能早于 stdout 读完，那样会丢掉尾部输出。
		child.on("close", (code) => finish(code));

		if (invocation.stdin !== undefined) {
			// 远端命令可能在读完 stdin 前就退出（例如路径不存在），此时写入会 EPIPE。
			// 那不是本地错误，真正的原因在 stderr 和退出码里。
			child.stdin.on("error", () => {});
			child.stdin.end(invocation.stdin);
		} else {
			child.stdin.end();
		}
	});
}

function openSshChannel(
	sshBinary: string,
	baseEnv: NodeJS.ProcessEnv,
	invocation: SshChannelInvocation,
): SshProcessChannel {
	const child = spawn(sshBinary, [...invocation.argv], {
		env: { ...baseEnv, ...invocation.env },
		stdio: ["pipe", "pipe", "pipe"],
	});
	const stderrChunks: Buffer[] = [];
	child.stdout.on("data", (chunk: Buffer) => invocation.onStdout(chunk));
	child.stderr.on("data", (chunk: Buffer) => keepTail(stderrChunks, chunk, STREAMED_STDERR_TAIL_BYTES));
	// 对端先走一步时写入会 EPIPE；真正的原因在退出码和 stderr 里，由 exited 报告。
	child.stdin.on("error", () => {});
	const exited = new Promise<{ exitCode: number | null; stderr: string }>((resolve) => {
		const finish = (exitCode: number | null): void =>
			resolve({ exitCode, stderr: Buffer.concat(stderrChunks).toString("utf8") });
		// 启动失败（找不到 ssh）只有 error 没有 close。
		child.once("error", () => finish(null));
		child.once("close", (code) => finish(code));
	});
	return {
		write: (data) => {
			if (child.stdin.writable) child.stdin.write(data);
		},
		end: () => child.stdin.end(),
		kill: () => {
			if (!child.killed) child.kill("SIGTERM");
		},
		exited,
	};
}

const STREAMED_STDERR_TAIL_BYTES = 16 * 1024;

function keepTail(chunks: Buffer[], chunk: Buffer, limitBytes: number): void {
	chunks.push(chunk);
	let total = 0;
	for (const item of chunks) total += item.byteLength;
	while (chunks.length > 1 && total - chunks[0].byteLength >= limitBytes) {
		total -= chunks[0].byteLength;
		chunks.shift();
	}
}
