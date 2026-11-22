import { useCallback, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

/**
 * 沙盒可用性的**唯一**判定入口。
 *
 * 之前有两份各自为政的实现：模型选择器在弹层打开时读一次并轮询，设置页只在挂载时读一次。
 * 于是同一台机器上两处可能给出相反结论（一处把 `unknown` 当可用、一处当不可用），也因
 * 为只读一次而错过主进程的异步探测——首次打开设置页时探测还没跑完，读到的就是 `unknown`。
 *
 * 现在状态放在模块级：一个定时器、一份快照、多个订阅者。设置页与选择器同时挂载时也只
 * 读一次配置，不会各转一个 1.5 秒的定时器。
 *
 * 状态语义：
 * - `available` → 可用；
 * - `unavailable` → 不可用，并给出可直接展示的原因码；
 * - `unknown`（探测在跑）→ 暂按不可用，每 1.5 秒重读，探测落地后自动放行。
 */

export type SandboxAvailabilityStatus = "unknown" | "available" | "unavailable";

export interface SandboxAvailabilitySnapshot {
	readonly status: SandboxAvailabilityStatus;
	/** 主进程给的原因码（`binary_not_found` 等），由展示层拼文案。 */
	readonly reasonCode: string;
	readonly platform: string;
}

export interface SandboxAvailability {
	/** 为空表示可用；否则是「为什么不给选」的成品文案。 */
	reason: string | null;
	status: SandboxAvailabilityStatus;
	/** 立刻重读一次，并在仍无结论时重启轮询。 */
	refresh: () => void;
}

/** 主进程的 Windows 宿主探测最长约 10 秒；轮询到 15 秒就停，避免无休止的定时器。 */
export const POLL_INTERVAL_MS = 1_500;
const POLL_BUDGET_MS = 15_000;

const KEY = "executionModeSelector.sandboxUnavailable";

let snapshot: SandboxAvailabilitySnapshot = { status: "unknown", reasonCode: "checking", platform: "unknown" };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let startedAt = 0;

function emit(next: SandboxAvailabilitySnapshot): void {
	if (
		next.status === snapshot.status &&
		next.reasonCode === snapshot.reasonCode &&
		next.platform === snapshot.platform
	) {
		return;
	}
	snapshot = next;
	for (const listener of listeners) listener();
}

function stopTimer(): void {
	if (timer) clearInterval(timer);
	timer = null;
}

async function readOnce(): Promise<void> {
	let nextStatus: SandboxAvailabilityStatus = "unknown";
	let reasonCode = "unknown_error";
	let platform = "unknown";
	try {
		const config = await window.astravia.config.get();
		const capability = config.sandbox ?? config.linuxSandbox;
		nextStatus = (capability?.status ?? "unknown") as SandboxAvailabilityStatus;
		reasonCode = capability?.reason ?? (nextStatus === "unknown" ? "checking" : "unknown_error");
		platform = capability && "platform" in capability ? String(capability.platform) : "linux";
	} catch {
		// 读配置失败不等于可用：保持 reasonCode 非空（unknown_error），下一轮再试。
	}
	emit({ status: nextStatus, reasonCode, platform });
	/*
	 * 结论到手就地停表，而不是等订阅者卸载。实测（jsdom + 假时钟）里，状态变化后的清理
	 * 时机不可靠：定时器会继续跳，每 1.5 秒白读一次配置。既然这里已经知道结果，就停。
	 */
	if (nextStatus !== "unknown") stopTimer();
}

function startPolling(): void {
	stopTimer();
	startedAt = Date.now();
	timer = setInterval(() => {
		if (Date.now() - startedAt > POLL_BUDGET_MS) {
			stopTimer();
			return;
		}
		void readOnce();
	}, POLL_INTERVAL_MS);
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	// 第一个订阅者负责启动：先读一次，再在仍无结论时轮询。
	if (listeners.size === 1 && !timer && snapshot.status === "unknown") {
		startedAt = Date.now();
		void readOnce();
		startPolling();
	}
	return () => {
		listeners.delete(listener);
		// 没人订阅就停表：设置页关掉之后不该继续读配置。
		if (listeners.size === 0) stopTimer();
	};
}

/** 立即重读；若探测仍无结论，重置预算并重启轮询（弹层重新打开时调用）。 */
export function refreshSandboxAvailability(): void {
	startedAt = Date.now();
	void readOnce();
	if (snapshot.status === "unknown") startPolling();
}

/** 测试用：把模块级状态与定时器恢复初始，避免用例之间互相污染。 */
export function resetSandboxAvailabilityForTest(): void {
	stopTimer();
	listeners.clear();
	snapshot = { status: "unknown", reasonCode: "checking", platform: "unknown" };
	startedAt = 0;
}

export function useSandboxAvailability(): SandboxAvailability {
	const { t } = useTranslation("chat");
	const current = useSyncExternalStore(
		subscribe,
		() => snapshot,
		() => snapshot,
	);
	const refresh = useCallback(() => refreshSandboxAvailability(), []);
	const reason =
		current.status === "available" ? null : t(KEY, { platform: current.platform, reason: current.reasonCode });
	return { reason, status: current.status, refresh };
}
