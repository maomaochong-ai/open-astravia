import { randomBytes } from "node:crypto";
import { createWriteStream, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	BackgroundCommandHost,
	BackgroundCommandOutputStore,
	BackgroundCommandProcess,
	BackgroundCommandProcessOperations,
	SpawnBackgroundCommandProcessOptions,
} from "@vetta/runtime-node/coding";
import { type SshConnection, type SshHelperClient, SshHelperClosedError } from "@vetta/ssh-transport";

/**
 * 远端后台任务（dev server、watcher 等）。
 *
 * 输出落在**本地**临时文件里：它已经跨过 SSH 到了本机，再往远端写一份只是多一次
 * 往返，而且读取还要再跨一次。
 *
 * 任务由谁托管取决于远端有没有 helper（ADR-0124 第二阶段）：有，任务在远端独立存活，
 * 本机断开、重连之后接着读输出；没有，任务绑在这条 SSH 通道上，通道一断就结束。
 */
export function createSshBackgroundCommandHost(connection: SshConnection): BackgroundCommandHost {
	return {
		processOperations: createSshBackgroundProcessOperations(connection),
		outputStore: localBackgroundCommandOutputStore,
	};
}

interface HelperTaskStatus {
	readonly id: string;
	readonly state: "live" | "exited" | "unverifiable";
	readonly exitCode?: number;
}

interface HelperTaskRead {
	readonly data: string;
	readonly nextOffset: number;
	readonly status: HelperTaskStatus;
}

/** 连接断开后隔多久再去够一次 helper。任务在远端照常跑着，这里只是等网络回来。 */
const HELPER_RECONNECT_DELAY_MS = 2_000;
const HELPER_READ_WAIT_MS = 20_000;

function createSshBackgroundProcessOperations(connection: SshConnection): BackgroundCommandProcessOperations {
	return {
		spawn(options) {
			let stopRequested = false;
			let stop: () => void = () => {
				stopRequested = true;
			};
			// 先问有没有 helper：有就交给远端托管，任务不再绑在这条 SSH 通道上；没有（平台
			// 不支持、上传失败）就退回通道内执行，行为与第一阶段一致。
			void connection.helper().then(
				(helper) => {
					const running = helper
						? superviseThroughHelper(connection, helper, options)
						: runOnChannel(connection, options);
					stop = running.stop;
					if (stopRequested) running.stop();
				},
				(error: unknown) => options.onError(error instanceof Error ? error : new Error(String(error))),
			);
			return { stop: () => stop() };
		},
	};
}

/**
 * 由远端 helper 托管的后台任务。
 *
 * 任务的进程组与输出都在远端，和这条连接无关：本机断网、合盖、甚至重启应用之后，任务
 * 照常在跑。这里只负责把输出搬回来——通道断了就等一会儿重连，从上次的偏移接着读。
 */
function superviseThroughHelper(
	connection: SshConnection,
	initialHelper: SshHelperClient,
	options: SpawnBackgroundCommandProcessOptions,
): BackgroundCommandProcess {
	let stopped = false;
	let taskId: string | undefined;

	const acquire = async (): Promise<SshHelperClient | undefined> => {
		while (!stopped) {
			const helper = await connection.helper().catch(() => undefined);
			if (helper && !helper.isClosed) return helper;
			await delay(HELPER_RECONNECT_DELAY_MS);
		}
		return undefined;
	};

	void (async () => {
		try {
			const started = await initialHelper.call<HelperTaskStatus>("proc.spawn", {
				command: options.command,
				cwd: options.cwd,
				env: toStringRecord(options.env),
			});
			taskId = started.id;
			let helper: SshHelperClient | undefined = initialHelper;
			let offset = 0;
			while (!stopped) {
				if (!helper || helper.isClosed) helper = await acquire();
				if (!helper) return;
				let read: HelperTaskRead;
				try {
					read = await helper.call<HelperTaskRead>("proc.read", {
						id: taskId,
						offset,
						waitMs: HELPER_READ_WAIT_MS,
					});
				} catch (error) {
					// 通道断了：任务还在，回头重连接着读。helper 明确答复的错误才是真失败。
					if (error instanceof SshHelperClosedError) continue;
					throw error;
				}
				if (read.data) options.onOutput(read.data);
				offset = read.nextOffset;
				if (read.status.state === "live" || read.data) continue;
				if (read.status.state === "exited") options.onExit(read.status.exitCode);
				// 进程不见了又没留下退出码：主机重启或被外部杀掉，结局不可知（ADR-0124）。
				else options.onError(new Error("The remote task ended without reporting an exit status."));
				void helper.call("proc.remove", { id: taskId }).catch(() => {});
				return;
			}
		} catch (error) {
			if (!stopped) options.onError(error instanceof Error ? error : new Error(String(error)));
		}
	})();

	return {
		stop: () => {
			if (stopped) return;
			stopped = true;
			const id = taskId;
			void (async () => {
				if (id === undefined) return;
				const helper = await connection.helper().catch(() => undefined);
				await helper?.call("proc.kill", { id }).catch(() => {});
				await helper?.call("proc.remove", { id }).catch(() => {});
			})();
			// 主动停止不是故障，不该在日志里冒出一条错误。
			options.onExit(undefined);
		},
	};
}

/** 没有 helper 时的执行方式：任务绑在这条 SSH 通道上，通道一断远端进程随之结束。 */
function runOnChannel(
	connection: SshConnection,
	{ command, cwd, env, onOutput, onExit, onError }: SpawnBackgroundCommandProcessOptions,
): BackgroundCommandProcess {
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
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds).unref?.();
	});
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
