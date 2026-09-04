import {
	activeSessionAtom,
	isStreamingAtom,
	type SessionExecutionMode,
	sessionExecutionModeAtom,
} from "@shared/store/atoms";
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
			localStorage.setItem("vetta-session-execution-mode", nextMode);
			if (!activeSession) return;
			try {
				await window.vetta.session.setExecutionMode(activeSession.runtimeId, nextMode);
			} catch (error) {
				setMode(previousMode);
				localStorage.setItem("vetta-session-execution-mode", previousMode);
				console.error("[ExecutionModeSelector] failed to switch execution mode:", error);
			}
		},
		[activeSession, mode, setMode],
	);
	return useExecutionModeSelectorModel({ mode, isStreaming, onSelectMode });
}

export function useExecutionModeSelectorModel(binding: ExecutionModeSelectorBinding): ExecutionModeSelectorViewProps {
	const { t } = useTranslation("chat");
	const [open, setOpen] = useState(false);
	const [isSwitching, setIsSwitching] = useState(false);
	const [sandboxUnavailableReason, setSandboxUnavailableReason] = useState<string | null>(null);
	const disabled = binding.isStreaming || isSwitching;

	useEffect(() => {
		void window.vetta.config.get().then((config) => {
			const capability = config.sandbox ?? config.linuxSandbox;
			if (capability?.status === "unavailable") {
				const reason = capability.reason ?? "unknown_error";
				const platform = "platform" in capability ? capability.platform : "linux";
				setSandboxUnavailableReason(t("executionModeSelector.sandboxUnavailable", { platform, reason }));
				return;
			}
			setSandboxUnavailableReason(null);
		});
	}, [t]);

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
				title:
					option.mode === "sandbox" && sandboxUnavailableReason ? sandboxUnavailableReason : titleFor(option.mode),
				disabled: option.mode === "sandbox" && !!sandboxUnavailableReason,
				selected: option.mode === binding.mode,
			})),
		[sandboxUnavailableReason, labelFor, titleFor, binding.mode],
	);

	const selectedOption = options.find((option) => option.mode === binding.mode) ?? options[0];

	const handleSelect = useCallback(
		async (nextMode: SessionExecutionMode) => {
			if (disabled || nextMode === binding.mode) return;
			if (nextMode === "sandbox" && sandboxUnavailableReason) return;
			setIsSwitching(true);
			try {
				await binding.onSelectMode(nextMode);
			} finally {
				setIsSwitching(false);
			}
		},
		[binding, disabled, sandboxUnavailableReason],
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
