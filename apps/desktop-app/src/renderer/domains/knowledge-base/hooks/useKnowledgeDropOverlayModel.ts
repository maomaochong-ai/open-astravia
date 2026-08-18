import { knowledgeImportDraftAtom } from "@shared/store/atoms";
import { useMatches, useNavigate } from "@tanstack/react-router";
import type { KnowledgeDropOverlayViewProps } from "@vetta/theme-ui/overlays";
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

function hasExternalFiles(event: DragEvent): boolean {
	return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function toSourcePaths(dataTransfer: DataTransfer): string[] {
	return Array.from(dataTransfer.files)
		.map((file) => window.vetta.fs.pathForFile(file))
		.filter(Boolean);
}

export type KnowledgeDropOverlayModel = KnowledgeDropOverlayViewProps;

export function useKnowledgeDropOverlayModel(): KnowledgeDropOverlayModel {
	const { t } = useTranslation("settings");
	const matches = useMatches();
	const path = matches[matches.length - 1]?.pathname ?? "/";
	const enabled = path.startsWith("/knowledge");
	const navigate = useNavigate();
	const setDraft = useSetAtom(knowledgeImportDraftAtom);
	const dragDepth = useRef(0);
	const [visible, setVisible] = useState(false);

	const reset = useCallback(() => {
		dragDepth.current = 0;
		setVisible(false);
	}, []);

	useEffect(() => {
		if (!enabled) {
			reset();
			return;
		}

		const onDragEnter = (event: DragEvent) => {
			if (!hasExternalFiles(event)) return;
			event.preventDefault();
			dragDepth.current += 1;
			setVisible(true);
		};
		const onDragOver = (event: DragEvent) => {
			if (!hasExternalFiles(event)) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
		};
		const onDragLeave = (event: DragEvent) => {
			if (!hasExternalFiles(event)) return;
			dragDepth.current = Math.max(0, dragDepth.current - 1);
			if (dragDepth.current === 0) setVisible(false);
		};
		const onDrop = (event: DragEvent) => {
			if (!hasExternalFiles(event) || !event.dataTransfer) return;
			event.preventDefault();
			const sourcePaths = toSourcePaths(event.dataTransfer);
			reset();
			if (sourcePaths.length === 0) return;
			setDraft({ sourcePaths, defaultTargetId: null });
			void navigate({ to: "/knowledge" });
		};

		window.addEventListener("dragenter", onDragEnter);
		window.addEventListener("dragover", onDragOver);
		window.addEventListener("dragleave", onDragLeave);
		window.addEventListener("drop", onDrop);
		return () => {
			window.removeEventListener("dragenter", onDragEnter);
			window.removeEventListener("dragover", onDragOver);
			window.removeEventListener("dragleave", onDragLeave);
			window.removeEventListener("drop", onDrop);
		};
	}, [enabled, navigate, reset, setDraft]);

	return {
		description: t("kbDropDesc"),
		enabled,
		title: t("kbDropTitle"),
		visible,
	};
}
