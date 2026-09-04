/**
 * 安装后步骤（`mcp.json` 的 `setup`）的执行状态机：
 * 起会话拿二维码 → 轮询完成标志 → 关闭时收掉连接。
 * 二维码由 MCP 服务产出，登录态也由它自己落盘，这里只负责取、显示和等。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { McpAbility } from "../types";

/** 完成判定读的是能力数据目录里的标志文件，轮询频率取一个人眼可接受又不浪费的值。 */
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
	const tool = item?.postInstallSetup?.tool;
	const statusKey = item && item.catalogSource.kind === "github" ? `${item.catalogSource.id}:${item.slug}` : undefined;

	const start = useCallback((): void => {
		if (!serverName || !tool || !statusKey) return;
		stopTimers();
		const run = ++runRef.current;
		const isStale = (): boolean => run !== runRef.current;
		setPhase("preparing");
		setImage(undefined);
		setError(undefined);

		const poll = (): void => {
			void window.vetta.abilities
				.getOpenMcpSetupStatus()
				.then((status) => {
					if (isStale() || status[statusKey] !== true) return;
					stopTimers();
					setPhase("completed");
					onCompletedRef.current();
				})
				.catch(() => undefined);
		};

		void window.vetta.mcp
			.startSetupLogin(serverName, tool)
			.then((qrCode) => {
				if (isStale()) return;
				setImage(qrCode.image);
				setPhase("scanning");
				timersRef.current.poll = setInterval(poll, POLL_INTERVAL_MS);
				timersRef.current.expiry = setTimeout(() => {
					if (isStale()) return;
					stopTimers();
					setPhase((current) => (current === "scanning" ? "expired" : current));
				}, qrCode.expiresInSeconds * 1000);
			})
			.catch((reason: unknown) => {
				if (isStale()) return;
				setError(errorMessage(reason));
				setPhase("failed");
			});
	}, [serverName, statusKey, stopTimers, tool]);

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
