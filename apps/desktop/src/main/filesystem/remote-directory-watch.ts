import { parseProjectLocation, type RemoteDirectoryEntry } from "@vetta/ssh-transport";
import { getSshConnection } from "../ssh/ssh-runtime.js";
import { assertRemotePathWithinProject } from "./remote-filesystem.js";

/**
 * 远端目录的变更监听。
 *
 * 远端有 helper 时由它在那台机器上本地比对，有变化才推一条通知；没有 helper（平台不支持、
 * 上传失败）时退回到从本机定期列目录、与上一次的快照比对。两条路对调用方是同一个接口：
 * Agent 在远端改了文件而文件树不动，用户会以为改动没发生，所以无论哪条路都保证「几秒内
 * 一定刷新」。
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
	let releaseHelper: (() => void) | undefined;

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

	const start = async (): Promise<void> => {
		const helper = await getSshConnection(location.hostId)
			.helper()
			.catch(() => undefined);
		if (stopped) return;
		if (!helper) {
			schedule(0);
			return;
		}
		try {
			await helper.call("watch.subscribe", { path: location.remotePath });
		} catch {
			// helper 说不行（目录不存在、没权限）：轮询那条路会按自己的节奏重试。
			schedule(0);
			return;
		}
		const off = helper.on("watch.changed", (params) => {
			if ((params as { path?: unknown } | undefined)?.path === location.remotePath && !stopped) onChange();
		});
		// 通道断了就重新来过：helper 回来接着订阅，回不来就落到轮询。期间可能漏掉的变化
		// 用一次通知补上——多刷新一次无害，漏刷新才是问题。
		const offClose = helper.onClose(() => {
			off();
			releaseHelper = undefined;
			if (stopped) return;
			onChange();
			timer = setTimeout(() => void start(), backoff);
			timer.unref?.();
		});
		releaseHelper = () => {
			off();
			offClose();
			void helper.call("watch.unsubscribe", { path: location.remotePath }).catch(() => {});
		};
		if (stopped) releaseHelper();
	};
	void start();

	return () => {
		stopped = true;
		if (timer) clearTimeout(timer);
		releaseHelper?.();
	};
}

function fingerprint(entries: readonly RemoteDirectoryEntry[]): string {
	return entries
		.map((entry) => `${entry.name}\0${entry.kind}\0${entry.sizeBytes}\0${entry.modifiedAtSeconds}`)
		.sort()
		.join("\n");
}
