import { isSshProjectUri } from "@astravia/ssh-transport/project-uri";
import { decodeNewSessionCwd } from "@shared/app-shell/new-session-route";
import {
	activeSessionAtom,
	isStreamingAtom,
	type SessionExecutionMode,
	sessionExecutionModeAtom,
} from "@shared/store/atoms";
import { showToast } from "@shared/store/toast-atoms";
import { useSearch } from "@tanstack/react-router";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	ExecutionModeOptionModel,
	ExecutionModeSelectorViewProps,
} from "../components/execution-mode-selector/types";

const MODE_OPTIONS: Array<{
	mode: SessionExecutionMode;
	icon: string;
}> = [
	{ mode: "sandbox", icon: "icon-[solar--shield-linear]" },
	{ mode: "full-access", icon: "icon-[solar--shield-cross-linear]" },
];

export interface ExecutionModeSelectorBinding {
	/**
	 * 当前会话或待建会话所在的项目。远程项目（`ssh://…`）没有沙箱——沙箱只能约束本机进程，
	 * 主进程会把这类会话固定为完全访问；选择器据此如实显示并禁用沙箱选项，而不是让用户
	 * 选了沙箱再吃一条报错。
	 */
	readonly cwd?: string | null;
	readonly mode: SessionExecutionMode;
	readonly isStreaming: boolean;
	readonly onSelectMode: (mode: SessionExecutionMode) => Promise<void> | void;
}

export function useDefaultExecutionModeSelectorModel(): ExecutionModeSelectorViewProps {
	const activeSession = useAtomValue(activeSessionAtom);
	const isStreaming = useAtomValue(isStreamingAtom);
	const [mode, setMode] = useAtom(sessionExecutionModeAtom);
	const onSelectMode = useCallback(
		async (nextMode: SessionExecutionMode) => {
			const previousMode = mode;
			setMode(nextMode);
			localStorage.setItem("astravia-session-execution-mode", nextMode);
			if (!activeSession) return;
			try {
				await window.astravia.session.setExecutionMode(activeSession.runtimeId, nextMode);
			} catch (error) {
				setMode(previousMode);
				localStorage.setItem("astravia-session-execution-mode", previousMode);
				console.error("[ExecutionModeSelector] failed to switch execution mode:", error);
			}
		},
		[activeSession, mode, setMode],
	);
	const search = useSearch({ strict: false }) as { cwd?: string };
	const cwd = activeSession?.cwd ?? decodeNewSessionCwd(search.cwd) ?? null;
	return useExecutionModeSelectorModel({ cwd, mode, isStreaming, onSelectMode });
}

export function useExecutionModeSelectorModel(binding: ExecutionModeSelectorBinding): ExecutionModeSelectorViewProps {
	const { t } = useTranslation("chat");
	const [open, setOpen] = useState(false);
	const [isSwitching, setIsSwitching] = useState(false);
	const [sandboxUnavailableReason, setSandboxUnavailableReason] = useState<string | null>(null);
	const disabled = binding.isStreaming || isSwitching;
	const isRemoteProject = typeof binding.cwd === "string" && isSshProjectUri(binding.cwd);
	const effectiveMode: SessionExecutionMode = isRemoteProject ? "full-access" : binding.mode;

	/**
	 * 读取一次沙箱能力。
	 *
	 * `unknown` 不能当成「可用」：主进程把探测放在首帧之后（Windows 的宿主探测最长 10 秒），
	 * 面板刚打开时读到的多半就是 `unknown`。那时可选沙箱、点了却被主进程拒绝并回滚，
	 * 用户看到的就是「切了没反应」。所以 `unknown` 也先按不可选处理，并在弹层每次打开时重读，
	 * 探测完成后自动放行。
	 */
	const readSandboxCapability = useCallback(() => {
		void window.astravia.config.get().then((config) => {
			const capability = config.sandbox ?? config.linuxSandbox;
			const status = capability?.status ?? "unknown";
			if (status === "available") {
				setSandboxUnavailableReason(null);
				return;
			}
			const reason = capability?.reason ?? (status === "unknown" ? "checking" : "unknown_error");
			const platform = capability && "platform" in capability ? capability.platform : "linux";
			setSandboxUnavailableReason(t("executionModeSelector.sandboxUnavailable", { platform, reason }));
		});
	}, [t]);

	useEffect(() => {
		readSandboxCapability();
	}, [readSandboxCapability]);

	/*
	 * 探测是异步的：首次打开弹层时它多半还没跑完。打开即重读，并在仍是「未知」时
	 * 短促轮询几次（Windows 宿主探测最长 10 秒），探测一落地选项就自动放行——
	 * 否则用户得关掉再打开一次才能看到沙箱可选。
	 */
	useEffect(() => {
		if (!open) return;
		readSandboxCapability();
		let attempts = 0;
		const timer = window.setInterval(() => {
			attempts += 1;
			if (attempts > 6) {
				window.clearInterval(timer);
				return;
			}
			readSandboxCapability();
		}, 1500);
		return () => window.clearInterval(timer);
	}, [open, readSandboxCapability]);

	const sandboxBlockedReason = isRemoteProject
		? t("executionModeSelector.sandboxUnavailableRemote")
		: sandboxUnavailableReason;

	const labelFor = useCallback(
		(m: SessionExecutionMode): string =>
			m === "sandbox" ? t("executionModeSelector.sandbox.label") : t("executionModeSelector.fullAccess.label"),
		[t],
	);
	const titleFor = useCallback(
		(m: SessionExecutionMode): string =>
			m === "sandbox" ? t("executionModeSelector.sandbox.title") : t("executionModeSelector.fullAccess.title"),
		[t],
	);

	const options = useMemo(
		(): ExecutionModeOptionModel[] =>
			MODE_OPTIONS.map((option) => ({
				...option,
				label: labelFor(option.mode),
				title: option.mode === "sandbox" && sandboxBlockedReason ? sandboxBlockedReason : titleFor(option.mode),
				disabled: option.mode === "sandbox" && !!sandboxBlockedReason,
				selected: option.mode === effectiveMode,
			})),
		[sandboxBlockedReason, labelFor, titleFor, effectiveMode],
	);

	const selectedOption = options.find((option) => option.mode === effectiveMode) ?? options[0];

	const handleSelect = useCallback(
		async (nextMode: SessionExecutionMode) => {
			if (disabled || nextMode === effectiveMode) return;
			if (nextMode === "sandbox" && sandboxBlockedReason) return;
			setIsSwitching(true);
			try {
				await binding.onSelectMode(nextMode);
			} catch (error) {
				/*
				 * 失败必须让人看见。主进程拒绝沙箱时给的是可读原因（「windows 沙盒不可用：…」），
				 * 之前只写 console——用户看到的是「点了又跳回去」，分不清是没权限还是系统不支持。
				 */
				showToast({
					variant: "error",
					title: t("executionModeSelector.switchFailedTitle"),
					message: error instanceof Error ? error.message : t("executionModeSelector.switchFailedMessage"),
				});
			} finally {
				setIsSwitching(false);
			}
		},
		[binding, disabled, effectiveMode, sandboxBlockedReason, t],
	);

	return {
		open,
		disabled,
		selectedOption,
		options,
		onOpenChange: setOpen,
		onSelect: (nextMode) => void handleSelect(nextMode as SessionExecutionMode),
	};
}
