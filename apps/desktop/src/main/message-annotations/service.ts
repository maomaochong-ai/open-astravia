import type { HistoryEntry } from "@vetta/runtime-core";
import type {
	AnnotationAsk,
	AnnotationChanged,
	AnnotationTurn,
	MessageAnnotation,
} from "../../shared/message-annotations.js";
import { annotationAskSchema } from "../../shared/message-annotations.js";
import { annotationContext } from "./context.js";
import { AnnotationStore, type StoredAnnotation } from "./store.js";

export interface AnnotationSource {
	path: string;
	modelKey: string;
	history: readonly HistoryEntry[];
}
export interface AnnotationCompletion {
	answer: string;
	stopReason: "stop" | "length";
	usage: NonNullable<AnnotationTurn["usage"]>;
}
export interface AnnotationServiceDependencies {
	source(runtimeId: string): AnnotationSource;
	complete(
		note: StoredAnnotation,
		modelKey: string,
		signal: AbortSignal,
		onText: (text: string) => void,
	): Promise<AnnotationCompletion>;
}

function publicNote({ context: _context, ...note }: StoredAnnotation): MessageAnnotation {
	return structuredClone(note);
}

export class MessageAnnotationService {
	private readonly listeners = new Set<(event: AnnotationChanged) => void>();
	private readonly running = new Map<string, { controller: AbortController; note?: StoredAnnotation }>();
	constructor(
		private readonly dependencies: AnnotationServiceDependencies,
		private readonly store = new AnnotationStore(),
	) {}

	onChanged(listener: (event: AnnotationChanged) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async list(runtimeId: string): Promise<MessageAnnotation[]> {
		const { path } = this.dependencies.source(runtimeId);
		const notes = await this.store.read(path);
		return notes
			.map((note) => {
				const live = this.running.get(`${path}:${note.id}`)?.note;
				return publicNote(
					live ?? {
						...note,
						turns: note.turns.map((turn) =>
							turn.status === "pending" ? { ...turn, status: "interrupted" } : turn,
						),
					},
				);
			})
			.sort((a, b) => b.createdAt - a.createdAt);
	}

	async ask(runtimeId: string, raw: AnnotationAsk): Promise<MessageAnnotation> {
		const input = annotationAskSchema.parse(raw);
		const source = this.dependencies.source(runtimeId);
		const key = `${source.path}:${input.id}`;
		if (this.running.has(key)) throw new Error("Annotation already answering");
		const run: { controller: AbortController; note?: StoredAnnotation } = { controller: new AbortController() };
		this.running.set(key, run);
		try {
			const existing = (await this.store.read(source.path)).find((note) => note.id === input.id);
			if (existing && (existing.entryId !== input.entryId || existing.quote !== input.quote))
				throw new Error("Annotation source cannot change");
			const note: StoredAnnotation = existing ?? {
				id: input.id,
				entryId: input.entryId,
				quote: input.quote,
				createdAt: Date.now(),
				context: annotationContext(source.history, input.entryId),
				turns: [],
			};
			note.turns = note.turns.map((turn) => (turn.status === "pending" ? { ...turn, status: "interrupted" } : turn));
			if (input.retry) {
				const last = note.turns.at(-1);
				if (!last || last.status === "completed" || last.question !== input.question)
					throw new Error("No failed question to retry");
				note.turns.pop();
			}
			const turn: AnnotationTurn = {
				question: input.question,
				answer: "",
				status: "pending",
				modelKey: source.modelKey,
			};
			note.turns.push(turn);
			run.note = note;
			await this.store.put(source.path, note);
			const emit = () => {
				const event = { sessionPath: source.path, annotation: publicNote(note) };
				for (const listener of this.listeners) listener(event);
			};
			emit();
			let lastEmission = 0;
			try {
				run.controller.signal.throwIfAborted();
				const result = await this.dependencies.complete(note, source.modelKey, run.controller.signal, (text) => {
					if (run.controller.signal.aborted) return;
					turn.answer = text;
					if (Date.now() - lastEmission >= 60) {
						lastEmission = Date.now();
						emit();
					}
				});
				run.controller.signal.throwIfAborted();
				Object.assign(turn, result, { status: "completed" });
			} catch {
				turn.status = run.controller.signal.aborted ? "cancelled" : "failed";
			}
			await this.store.put(source.path, note);
			emit();
			return publicNote(note);
		} finally {
			this.running.delete(key);
		}
	}

	cancel(runtimeId: string, id: string): void {
		const { path } = this.dependencies.source(runtimeId);
		this.running.get(`${path}:${id}`)?.controller.abort();
	}

	async forget(sessionPath: string): Promise<void> {
		for (const [key, run] of this.running) if (key.startsWith(`${sessionPath}:`)) run.controller.abort();
		await this.store.remove(sessionPath);
	}

	dispose(): void {
		for (const run of this.running.values()) run.controller.abort();
	}
}
