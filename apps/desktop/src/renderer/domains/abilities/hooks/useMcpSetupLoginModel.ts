/**
 * 安装后步骤（`mcp.json` 的 `setup`）的执行状态机：
 * 请求上游二维码 → 轮询上游登录状态 → 关闭时取消未完成请求。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { McpAbility } from "../types";

const POLL_INTERVAL_MS = 2000;

export type McpSetupLoginPhase = "preparing" | "scanning" | "completed" | "expired" | "failed";

export interface McpSetupLoginModel {
	readonly phase: McpSetupLoginPhase;
	readonly image?: string;
	readonly error?: string;
	readonly retry: () => void;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function useMcpSetupLoginModel({
	item,
	onCompleted,
}: {
	item: McpAbility | null;
	onCompleted: () => void;
}): McpSetupLoginModel {
	const [phase, setPhase] = useState<McpSetupLoginPhase>("preparing");
	const [image, setImage] = useState<string | undefined>();
	const [error, setError] = useState<string | undefined>();
	/** 完成回调不参与依赖，父组件重渲染不该重开会话。 */
	const onCompletedRef = useRef(onCompleted);
	onCompletedRef.current = onCompleted;
	const timersRef = useRef<{ expiry?: ReturnType<typeof setTimeout>; poll?: ReturnType<typeof setInterval> }>({});
	/** 每次取码自增：迟到的响应与旧计时器据此作废。 */
	const runRef = useRef(0);

	const stopTimers = useCallback(() => {
		if (timersRef.current.expiry) clearTimeout(timersRef.current.expiry);
		if (timersRef.current.poll) clearInterval(timersRef.current.poll);
		timersRef.current = {};
	}, []);

	const serverName = item?.serverName;

	const start = useCallback((): void => {
		if (!serverName) return;
		stopTimers();
		const run = ++runRef.current;
		const isStale = (): boolean => run !== runRef.current;
		setPhase("preparing");
		setImage(undefined);
		setError(undefined);
		let polling = false;

		const poll = (): void => {
			if (polling || isStale()) return;
			polling = true;
			void window.vetta.mcp
				.getSetupLoginStatus(serverName)
				.then((status) => {
					if (isStale() || status.state !== "authenticated") return;
					runRef.current += 1;
					stopTimers();
					setPhase("completed");
					void window.vetta.mcp.cancelSetupLogin().catch(() => undefined);
					onCompletedRef.current();
				})
				.catch((reason: unknown) => {
					if (isStale()) return;
					runRef.current += 1;
					stopTimers();
					setError(errorMessage(reason));
					setPhase("failed");
				})
				.finally(() => {
					polling = false;
				});
		};

		void window.vetta.mcp
			.startSetupLogin(serverName)
			.then((qrCode) => {
				if (isStale()) return;
				if (qrCode.state === "authenticated") {
					setPhase("completed");
					onCompletedRef.current();
					return;
				}
				setImage(qrCode.image);
				setPhase("scanning");
				timersRef.current.poll = setInterval(poll, POLL_INTERVAL_MS);
				timersRef.current.expiry = setTimeout(() => {
					if (isStale()) return;
					runRef.current += 1;
					stopTimers();
					setPhase((current) => (current === "scanning" ? "expired" : current));
				}, qrCode.expiresInSeconds * 1000);
			})
			.catch((reason: unknown) => {
				if (isStale()) return;
				setError(errorMessage(reason));
				setPhase("failed");
			});
	}, [serverName, stopTimers]);

	useEffect(() => {
		start();
		return () => {
			runRef.current += 1;
			stopTimers();
			void window.vetta.mcp.cancelSetupLogin().catch(() => undefined);
		};
	}, [start, stopTimers]);

	return { phase, image, error, retry: start };
}
