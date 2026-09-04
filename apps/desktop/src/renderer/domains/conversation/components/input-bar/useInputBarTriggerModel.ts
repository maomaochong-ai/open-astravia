import type { SkillInfo } from "@preload/api";
import { recordInputFilesAdded } from "@shared/lib/app-monitor-events";
import { isImagePath } from "@shared/lib/input-tokens";
import { perfSendBegin, perfSendMark } from "@shared/lib/perf-send";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectorGridItem } from "../../hooks/useConnectorGrid";
import type { SelectedFile } from "../AtPanel";
import { PANEL_REVEAL_MS } from "../command-panel/constants";
import {
	focusInputEditor,
	insertConnectorToken,
	insertFileToken,
	insertImageToken,
	insertSceneToken,
	insertSkillToken,
} from "./editor/inputEditorHandle";
import type { TriggerMatch } from "./editor/tokens/trigger";
import type { SendInteractionContext } from "./types";
import { useInputBarPanelModel } from "./useInputBarPanelModel";

async function readFileSize(path: string, isDirectory: boolean): Promise<number | undefined> {
	if (isDirectory) return undefined;
	const stat = await window.vetta.fs.stat(path).catch(() => null);
	return stat && stat.size > 0 ? stat.size : undefined;
}

export function useInputBarTriggerModel({
	hasSession,
	isStreaming,
	isEmpty,
	canSend,
	firstSuggestion,
	activeSession,
	focusInputRequest,
	activityWorkspaceId,
	onExpandedChange,
	onSend,
	onAbort,
}: {
	hasSession: boolean;
	isStreaming: boolean;
	isEmpty: boolean;
	canSend: boolean;
	firstSuggestion?: string;
	activeSession: { cwd: string; runtimeId: string } | null;
	focusInputRequest: number;
	activityWorkspaceId?: string;
	onExpandedChange?: (expanded: boolean) => void;
	onSend: (overrideText?: string, context?: SendInteractionContext) => Promise<void>;
	onAbort: () => Promise<void>;
}) {
	const [isFocused, setIsFocused] = useState(false);
	const [trigger, setTrigger] = useState<TriggerMatch | null>(null);
	const dismissedTriggerRef = useRef<string | null>(null);
	const { drawerActiveTab, setDrawerActiveTab, openTodoPanel } = useInputBarPanelModel(
		activeSession,
		activityWorkspaceId,
	);

	const slashOpen = trigger?.kind === "slash" && dismissedTriggerRef.current !== `/${trigger.query}`;
	const atOpen = trigger?.kind === "at" && dismissedTriggerRef.current !== `@${trigger.query}`;
	const slashFilter = trigger?.kind === "slash" ? `/${trigger.query}` : "";
	const atFilter = trigger?.kind === "at" ? `@${trigger.query}` : "";
	const [slashVisible, setSlashVisible] = useState(false);

	useEffect(() => onExpandedChange?.(slashOpen), [onExpandedChange, slashOpen]);
	useEffect(() => {
		if (slashOpen) {
			setSlashVisible(true);
			return;
		}
		const timer = window.setTimeout(() => setSlashVisible(false), PANEL_REVEAL_MS);
		return () => window.clearTimeout(timer);
	}, [slashOpen]);
	useEffect(() => {
		if (hasSession && !isStreaming) focusInputEditor();
	}, [hasSession, isStreaming]);
	useEffect(() => {
		if (focusInputRequest > 0) focusInputEditor();
	}, [focusInputRequest]);

	const handleSend = useCallback(() => {
		const interactionId = perfSendBegin("send-button");
		void onSend(undefined, { interactionId });
		perfSendMark("handler-return", interactionId);
	}, [onSend]);
	const handleAbort = useCallback(async () => {
		try {
			await onAbort();
		} catch (error) {
			console.error("[useInputBarTriggerModel] abort failed", error);
			throw error;
		}
	}, [onAbort]);
	const handleEnter = useCallback((): boolean => {
		if (canSend) {
			const interactionId = perfSendBegin("enter");
			void onSend(undefined, { interactionId });
			perfSendMark("handler-return", interactionId);
			return true;
		}
		if (isStreaming && hasSession && !isEmpty) {
			void onSend();
			return true;
		}
		if (hasSession && !isStreaming && isEmpty && firstSuggestion) {
			const interactionId = perfSendBegin("suggestion-enter");
			void onSend(firstSuggestion, { interactionId });
			perfSendMark("handler-return", interactionId);
			return true;
		}
		return false;
	}, [canSend, firstSuggestion, hasSession, isEmpty, isStreaming, onSend]);

	const handleTriggerChange = useCallback((next: TriggerMatch | null) => {
		setTrigger(next);
		const key = next ? `${next.kind === "slash" ? "/" : "@"}${next.query}` : null;
		if (dismissedTriggerRef.current !== null && dismissedTriggerRef.current !== key) {
			dismissedTriggerRef.current = null;
		}
	}, []);
	const dismissTrigger = useCallback(() => {
		if (!trigger) return;
		dismissedTriggerRef.current = `${trigger.kind === "slash" ? "/" : "@"}${trigger.query}`;
		setTrigger(null);
	}, [trigger]);
	const handleSlashSelect = useCallback((skill: SkillInfo, icon?: string) => {
		if (skill.type === "scene") insertSceneToken(skill.name, skill.alias, icon, { replaceTrigger: true });
		else insertSkillToken(skill.name, skill.alias, icon, { replaceTrigger: true });
		setTrigger(null);
		focusInputEditor();
	}, []);
	const handleConnectorSelect = useCallback((connector: ConnectorGridItem) => {
		insertConnectorToken(connector.name, connector.label, connector.iconUrl, { replaceTrigger: true });
		setTrigger(null);
		focusInputEditor();
	}, []);
	const handleAtSelect = useCallback(async (file: SelectedFile) => {
		if (isImagePath(file.path)) insertImageToken(file.path, { replaceTrigger: true });
		else insertFileToken(file.path, file.isDirectory, { replaceTrigger: true });
		setTrigger(null);
		const sizeBytes = await readFileSize(file.path, file.isDirectory);
		recordInputFilesAdded("at-panel", [
			{
				path: file.path,
				name: file.name,
				isDirectory: file.isDirectory,
				...(sizeBytes === undefined ? {} : { sizeBytes }),
			},
		]);
		focusInputEditor();
	}, []);
	const handlePlusClick = useCallback(() => {
		if (!hasSession) return;
		setTrigger((prev) => (prev?.kind === "slash" ? null : { kind: "slash", query: "", length: 0 }));
		dismissedTriggerRef.current = null;
	}, [hasSession]);

	return {
		atFilter,
		atOpen,
		drawerActiveTab,
		handleAbort,
		handleAtClose: dismissTrigger,
		handleAtSelect,
		handleConnectorSelect,
		handleEnter,
		handlePlusClick,
		handleSend,
		handleSlashClose: dismissTrigger,
		handleSlashSelect,
		handleTriggerChange,
		isFocused,
		openTodoPanel,
		setDrawerActiveTab,
		setIsFocused,
		slashFilter,
		slashOpen,
		slashVisible,
	};
}
