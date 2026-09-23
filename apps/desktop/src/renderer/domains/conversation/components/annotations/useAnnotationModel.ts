import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import type { ActiveSession } from "@shared/store/atoms";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageAnnotation } from "../../../../../shared/message-annotations";

export interface AnnotationTarget {
	id: string;
	entryId: string;
	quote: string;
}

export function useAnnotationModel(session: ActiveSession) {
	const [notes, setNotes] = useState<MessageAnnotation[]>([]);
	const [target, setTarget] = useState<AnnotationTarget | null>(null);
	const [open, setOpen] = useState(false);
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(false);
	const [sending, setSending] = useState<string | null>(null);
	const alive = useRef(true);
	const inFlight = useRef(new Map<string, { started: boolean; cancelled: boolean }>());
	const revision = useRef(0);
	const upsert = useCallback((note: MessageAnnotation) => {
		if (!alive.current) return;
		revision.current++;
		setNotes((current) => [note, ...current.filter((item) => item.id !== note.id)]);
	}, []);
	const reload = useCallback(async () => {
		setLoading(true);
		setError(false);
		const startRevision = revision.current;
		try {
			await waitForCommittedPaint();
			if (!alive.current) return;
			const loaded = await window.vetta.messageAnnotations.list(session.runtimeId);
			if (alive.current)
				setNotes((current) =>
					revision.current === startRevision
						? loaded
						: [...current, ...loaded.filter((note) => !current.some((item) => item.id === note.id))],
				);
		} catch {
			if (alive.current) setError(true);
		} finally {
			if (alive.current) setLoading(false);
		}
	}, [session.runtimeId]);
	useEffect(() => {
		alive.current = true;
		const unsubscribe = window.vetta.messageAnnotations.onChanged((event) => {
			if (event.sessionPath === session.sessionPath) upsert(event.annotation);
		});
		void reload();
		return () => {
			alive.current = false;
			unsubscribe();
		};
	}, [reload, session.sessionPath, upsert]);
	const note = target ? notes.find((item) => item.id === target.id) : undefined;
	const draft = target ? (drafts[target.id] ?? "") : "";
	const setDraft = (value: string) => {
		if (target) setDrafts((current) => ({ ...current, [target.id]: value }));
	};
	const send = async (retry = false) => {
		if (!target || inFlight.current.has(target.id)) return;
		const question = retry ? note?.turns.at(-1)?.question : draft.trim();
		if (!question) return;
		const captured = target;
		const operation = { started: false, cancelled: false };
		inFlight.current.set(captured.id, operation);
		setSending(captured.id);
		setError(false);
		try {
			await waitForCommittedPaint();
			if (!alive.current || operation.cancelled) return;
			operation.started = true;
			const result = await window.vetta.messageAnnotations.ask(session.runtimeId, {
				id: captured.id,
				entryId: captured.entryId,
				quote: captured.quote,
				question,
				retry,
			});
			upsert(result);
			if (alive.current && !retry)
				setDrafts((current) =>
					current[captured.id]?.trim() === question ? { ...current, [captured.id]: "" } : current,
				);
		} catch {
			if (alive.current) setError(true);
		} finally {
			inFlight.current.delete(captured.id);
			if (alive.current) setSending((current) => (current === captured.id ? null : current));
		}
	};
	const cancel = async () => {
		if (!target) return;
		const operation = inFlight.current.get(target.id);
		if (operation && !operation.started) {
			operation.cancelled = true;
			return;
		}
		try {
			await window.vetta.messageAnnotations.cancel(session.runtimeId, target.id);
		} catch {
			if (alive.current) setError(true);
		}
	};
	return {
		notes,
		target,
		setTarget,
		open,
		setOpen,
		note,
		draft,
		setDraft,
		loading,
		error,
		pending: sending === target?.id || note?.turns.at(-1)?.status === "pending",
		reload,
		send,
		cancel,
	};
}
