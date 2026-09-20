import { randomBytes } from "node:crypto";
import { createWriteStream, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	BackgroundCommandHost,
	BackgroundCommandOutputStore,
	BackgroundCommandProcessOperations,
} from "@vetta/runtime-node/coding";
import type { SshConnection } from "@vetta/ssh-transport";

/**
 * 远端后台任务（dev server、watcher 等）。
 *
 * 输出落在**本地**临时文件里：它已经跨过 SSH 到了本机，再往远端写一份只是多一次
 * 往返，而且读取还要再跨一次。
 *
 * 进程与这条 SSH 通道同生共死：通道断开时远端进程收到 SIGHUP 结束。ADR-0120 记录的
 * 结构性限制在这里具体化——本机断开后远端任务不会继续跑。要让它活下去需要在远端
 * 托管进程并把输出写到远端文件，那属于第二阶段 helper 的范围。
 */
export function createSshBackgroundCommandHost(connection: SshConnection): BackgroundCommandHost {
	return {
		processOperations: createSshBackgroundProcessOperations(connection),
		outputStore: localBackgroundCommandOutputStore,
	};
}

function createSshBackgroundProcessOperations(connection: SshConnection): BackgroundCommandProcessOperations {
	return {
		spawn({ command, cwd, env, onOutput, onExit, onError }) {
			const controller = new AbortController();
			const decoder = new TextDecoder();
			const emit = (chunk: Uint8Array): void => onOutput(decoder.decode(chunk, { stream: true }));

			connection
				.exec(command, {
					cwd,
					env: toStringRecord(env),
					onStdout: emit,
					// 后台任务的报错和正常输出合成一条流：分开会让两者在时间上错位，
					// 而用户看的是一份滚动日志。
					onStderr: emit,
					signal: controller.signal,
				})
				.then((result) => onExit(result.exitCode))
				.catch((error: unknown) => {
					// 主动停止不是故障，不该在日志里冒出一条错误。
					if (controller.signal.aborted) {
						onExit(undefined);
						return;
					}
					onError(error instanceof Error ? error : new Error(String(error)));
				});

			return { stop: () => controller.abort() };
		},
	};
}

function toStringRecord(env: NodeJS.ProcessEnv): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (typeof value === "string") result[key] = value;
	}
	return result;
}

const localBackgroundCommandOutputStore: BackgroundCommandOutputStore = {
	create(taskId) {
		const path = join(tmpdir(), `vetta-remote-task-${taskId}-${randomBytes(4).toString("hex")}.log`);
		const stream = createWriteStream(path);
		return {
			path,
			append: (text) => stream.write(text),
			read: (offset) => readFileSync(path).subarray(offset).toString("utf-8"),
			close: () => stream.end(),
		};
	},
};
