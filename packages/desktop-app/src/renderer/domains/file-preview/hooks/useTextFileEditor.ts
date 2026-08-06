import { type FileEditorDocumentState, fileEditorDocumentsAtom } from "@shared/store/atoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	applyEditorSaveResult,
	createEditorDocument,
	isEditorDocumentDirty,
	mergeEditorSnapshot,
	updateEditorDraft,
} from "../services/editor-document-state";

type LoadStatus = "loading" | "ready" | "error";

export interface TextFileEditorModel {
	document: FileEditorDocumentState | undefined;
	loadStatus: LoadStatus;
	loadError: unknown;
	saveError: unknown;
	saving: boolean;
	dirty: boolean;
	updateDraft: (content: string) => void;
	save: (force?: boolean) => Promise<void>;
	reloadFromDisk: () => Promise<void>;
}

export function useTextFileEditor(path: string, refreshNonce: number): TextFileEditorModel {
	const documents = useAtomValue(fileEditorDocumentsAtom);
	const setDocuments = useSetAtom(fileEditorDocumentsAtom);
	const document = documents.get(path);
	const [loadStatus, setLoadStatus] = useState<LoadStatus>(document ? "ready" : "loading");
	const [loadError, setLoadError] = useState<unknown>(null);
	const [saveError, setSaveError] = useState<unknown>(null);
	const [saving, setSaving] = useState(false);
	const savingRef = useRef(false);
	const loadRequestIdRef = useRef(0);
	const hasDocumentRef = useRef(Boolean(document));
	hasDocumentRef.current = Boolean(document);

	const loadFromDisk = useCallback(
		async (discardDraft: boolean): Promise<void> => {
			const requestId = ++loadRequestIdRef.current;
			setLoadStatus((current) => (hasDocumentRef.current ? current : "loading"));
			try {
				const snapshot = await window.vetta.fs.readEditableTextFile(path);
				if (requestId !== loadRequestIdRef.current) return;
				setDocuments((current) => {
					const next = new Map(current);
					const existing = current.get(path);
					next.set(
						path,
						discardDraft
							? createEditorDocument(path, snapshot, existing?.editorGeneration)
							: mergeEditorSnapshot(existing, path, snapshot),
					);
					return next;
				});
				setLoadError(null);
				setSaveError(null);
				setLoadStatus("ready");
			} catch (error: unknown) {
				if (requestId !== loadRequestIdRef.current) return;
				setLoadError(error);
				setLoadStatus("error");
			}
		},
		[path, setDocuments],
	);

	useEffect(() => {
		if (!Number.isFinite(refreshNonce)) return;
		void loadFromDisk(false);
	}, [loadFromDisk, refreshNonce]);

	useEffect(() => {
		const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
		const directory = slash > 0 ? path.slice(0, slash) : path;
		void window.vetta.fs.watchDir(directory);
		const unsubscribe = window.vetta.fs.onDirChanged((changedDirectory) => {
			if (changedDirectory === directory && !savingRef.current) {
				void loadFromDisk(false);
			}
		});
		return () => {
			unsubscribe();
			void window.vetta.fs.unwatchDir(directory);
		};
	}, [loadFromDisk, path]);

	const updateDraft = useCallback(
		(content: string) => {
			setDocuments((current) => {
				const existing = current.get(path);
				if (!existing) return current;
				const updated = updateEditorDraft(existing, content);
				if (updated === existing) return current;
				const next = new Map(current);
				next.set(path, updated);
				return next;
			});
			setSaveError(null);
		},
		[path, setDocuments],
	);

	const save = useCallback(
		async (force = false): Promise<void> => {
			if (!document || savingRef.current || (!force && !isEditorDocumentDirty(document))) return;
			const contentToSave = document.draftContent;
			savingRef.current = true;
			setSaving(true);
			setSaveError(null);
			try {
				const result = await window.vetta.fs.saveEditableTextFile(path, contentToSave, {
					expectedRevision: document.revision,
					force,
					hasBom: document.hasBom,
				});
				setDocuments((current) => {
					const existing = current.get(path);
					if (!existing) return current;
					const next = new Map(current);
					next.set(path, applyEditorSaveResult(existing, contentToSave, result));
					return next;
				});
			} catch (error: unknown) {
				setSaveError(error);
			} finally {
				savingRef.current = false;
				setSaving(false);
			}
		},
		[document, path, setDocuments],
	);

	const reloadFromDisk = useCallback(async () => {
		await loadFromDisk(true);
	}, [loadFromDisk]);

	return {
		document,
		loadStatus,
		loadError,
		saveError,
		saving,
		dirty: document ? isEditorDocumentDirty(document) : false,
		updateDraft,
		save,
		reloadFromDisk,
	};
}
