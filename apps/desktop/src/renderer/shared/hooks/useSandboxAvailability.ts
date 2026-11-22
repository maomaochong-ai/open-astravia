import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * 沙盒可用性的唯一判定入口。
 *
 * 之前有两份各自为政的实现：模型选择器在弹层打开时读一次并轮询，设置页只在挂载时读一次。
 * 于是同一台机器上两处可能给出相反结论，也因为只读一次而错过主进程的异步探测——
 * 首次打开设置页时探测还没跑完，读到的就是 `unknown`，而那份实现把它当成「可用」。
 *
 * 这里的规则：
 * - `available` → 可用；
 * - `unavailable` → 不可用，并给出可直接展示的原因；
 * - `unknown`（探测在跑）→ 暂按不可用，但每 1.5 秒重读，探测落地后自动放行。
 *
 * `reason` 非空即「不给选」，因此初始值就带着 checking 文案，不会出现「先放行、再禁用」的闪动。
 */

export type SandboxAvailabilityStatus = "unknown" | "available" | "unavailable";

export interface SandboxAvailability {
	/** 为空表示可用；否则是「为什么不给选」的成品文案。 */
	reason: string | null;
	status: SandboxAvailabilityStatus;
	/** 立刻重读一次（例如下拉被打开时）。 */
	refresh: () => void;
}

/** 主进程的 Windows 宿主探测最长约 10 秒；轮询到 15 秒就停，避免无休止的定时器。 */
const POLL_INTERVAL_MS = 1_500;
const POLL_BUDGET_MS = 15_000;

const KEY = "executionModeSelector.sandboxUnavailable";

export function useSandboxAvailability(): SandboxAvailability {
	const { t } = useTranslation("chat");
	const [status, setStatus] = useState<SandboxAvailabilityStatus>("unknown");
	const [reason, setReason] = useState<string | null>(() => t(KEY, { platform: "unknown", reason: "checking" }));
	const startedAtRef = useRef<number>(Date.now());
	const mountedRef = useRef(true);

	useEffect(
		() => () => {
			mountedRef.current = false;
		},
		[],
	);

	const read = useCallback(async () => {
		let nextStatus: SandboxAvailabilityStatus = "unknown";
		let nextReason: string | null;
		try {
			const config = await window.astravia.config.get();
			const capability = config.sandbox ?? config.linuxSandbox;
			nextStatus = (capability?.status ?? "unknown") as SandboxAvailabilityStatus;
			const why = capability?.reason ?? (nextStatus === "unknown" ? "checking" : "unknown_error");
			const platform = capability && "platform" in capability ? capability.platform : "linux";
			nextReason = nextStatus === "available" ? null : t(KEY, { platform, reason: why });
		} catch {
			// 读配置失败不等于可用：保持 unavailable 语义（reason 非空），下一轮再试。
			nextReason = t(KEY, { platform: "unknown", reason: "unknown_error" });
		}
		if (!mountedRef.current) return;
		setStatus(nextStatus);
		setReason(nextReason);
	}, [t]);

	useEffect(() => {
		startedAtRef.current = Date.now();
		void read();
	}, [read]);

	// 只在「探测还没结论」时轮询：已有 available / unavailable 结论的机器不必反复读配置。
	useEffect(() => {
		if (status !== "unknown") return;
		const timer = setInterval(() => {
			if (Date.now() - startedAtRef.current > POLL_BUDGET_MS) {
				clearInterval(timer);
				return;
			}
			void read();
		}, POLL_INTERVAL_MS);
		return () => clearInterval(timer);
	}, [status, read]);

	const refresh = useCallback(() => {
		startedAtRef.current = Date.now();
		void read();
	}, [read]);

	return { reason, status, refresh };
}
