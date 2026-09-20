import { parseProjectLocation, type RemoteDirectoryEntry } from "@vetta/ssh-transport";
import { getSshConnection } from "../ssh/ssh-runtime.js";
import { assertRemotePathWithinProject } from "./remote-filesystem.js";

/**
 * 远端目录的变更监听。
 *
 * 远端零安装（ADR-0124 第一阶段），拿不到 inotify，只能定期列目录、与上一次的快照比对。
 * Agent 在远端改了文件而文件树不动，用户会以为改动没发生——所以宁可用轮询换来「几秒内
 * 一定刷新」，也不让远程项目的文件树停在打开那一刻。第二阶段的远端 helper 接上真正的
 * 文件监听后，只需要替换这个模块的实现。
 */
const POLL_INTERVAL_MS = 3_000;
/** 连不上时放慢节奏，别对着一台掉线的主机每 3 秒重试一次。 */
const FAILURE_BACKOFF_MS = 15_000;

export interface RemoteDirectoryWatchOptions {
	readonly pollIntervalMs?: number;
	readonly failureBackoffMs?: number;
}

/** 开始监听；返回的函数停止监听。目录内容变化时调用 `onChange`（首次快照不算变化）。 */
export function watchRemoteDirectory(
	uri: string,
	onChange: () => void,
	options: RemoteDirectoryWatchOptions = {},
): () => void {
	assertRemotePathWithinProject(uri);
	const location = parseProjectLocation(uri);
	if (location.kind !== "ssh") throw new Error(`Not a remote path: ${uri}`);
	const interval = options.pollIntervalMs ?? POLL_INTERVAL_MS;
	const backoff = options.failureBackoffMs ?? FAILURE_BACKOFF_MS;

	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let previous: string | undefined;

	const schedule = (delay: number): void => {
		if (stopped) return;
		timer = setTimeout(poll, delay);
		timer.unref?.();
	};
	// 上一轮没回来就不发下一轮：慢链路上叠起来的请求只会让它更慢。
	const poll = async (): Promise<void> => {
		let nextDelay = interval;
		try {
			const entries = await getSshConnection(location.hostId).listDirectory(location.remotePath);
			const snapshot = fingerprint(entries);
			if (previous !== undefined && previous !== snapshot && !stopped) onChange();
			previous = snapshot;
		} catch {
			// 目录被删、主机掉线都走这里。保留上一次的快照：恢复后若内容变了仍能报出来。
			nextDelay = backoff;
		}
		schedule(nextDelay);
	};
	schedule(0);

	return () => {
		stopped = true;
		if (timer) clearTimeout(timer);
	};
}

function fingerprint(entries: readonly RemoteDirectoryEntry[]): string {
	return entries
		.map((entry) => `${entry.name}\0${entry.kind}\0${entry.sizeBytes}\0${entry.modifiedAtSeconds}`)
		.sort()
		.join("\n");
}
