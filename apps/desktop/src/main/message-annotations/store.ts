import { readFile, rm, stat } from "node:fs/promises";
import { atomicWriteJSONAsync } from "@vetta/toolkit/atomic-write";
import { z } from "zod";
import { annotationSchema } from "../../shared/message-annotations.js";

const documentSchema = z.object({
	schemaVersion: z.literal(1),
	annotations: z.array(annotationSchema.extend({ context: z.string() })),
});
export type StoredAnnotation = z.infer<typeof documentSchema>["annotations"][number];
export const annotationFile = (sessionPath: string): string => `${sessionPath}.annotations.json`;

/** Only host-resolved session paths reach this store. Atomic, serialized updates preserve sibling notes. */
export class AnnotationStore {
	private tail: Promise<unknown> = Promise.resolve();

	async read(sessionPath: string): Promise<StoredAnnotation[]> {
		await this.tail.catch(() => undefined);
		return this.readFile(sessionPath);
	}

	private async readFile(sessionPath: string): Promise<StoredAnnotation[]> {
		try {
			return documentSchema.parse(JSON.parse(await readFile(annotationFile(sessionPath), "utf8"))).annotations;
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
			throw error;
		}
	}

	put(sessionPath: string, annotation: StoredAnnotation): Promise<void> {
		const snapshot = structuredClone(annotation);
		const operation = this.tail
			.catch(() => undefined)
			.then(async () => {
				await stat(sessionPath); // Never recreate records after the source session was deleted.
				const notes = await this.readFile(sessionPath);
				const next = notes.filter((note) => note.id !== snapshot.id);
				next.push(snapshot);
				await atomicWriteJSONAsync(annotationFile(sessionPath), { schemaVersion: 1, annotations: next });
			});
		this.tail = operation;
		return operation;
	}

	remove(sessionPath: string): Promise<void> {
		const operation = this.tail.catch(() => undefined).then(() => rm(annotationFile(sessionPath), { force: true }));
		this.tail = operation;
		return operation;
	}
}
