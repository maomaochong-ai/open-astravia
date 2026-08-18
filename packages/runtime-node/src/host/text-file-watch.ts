import { watch } from "node:fs";
import { readFile } from "node:fs/promises";

export type NodeTextFileWatchEvent =
	| { readonly kind: "changed"; readonly content: string }
	| { readonly kind: "removed" };

export interface NodeTextFileWatchPort {
	watch(path: string, listener: (event: NodeTextFileWatchEvent) => void): { close(): void };
}

function isMissingFileError(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** Debounced Node adapter for text-file change notifications. */
export function createNodeTextFileWatchPort(debounceMs = 100): NodeTextFileWatchPort {
	return {
		watch(path, listener) {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const fileWatcher = watch(path, () => {
				if (timer) clearTimeout(timer);
				timer = setTimeout(() => {
					timer = undefined;
					void readFile(path, "utf8").then(
						(content) => listener({ kind: "changed", content }),
						(error: unknown) => {
							if (isMissingFileError(error)) listener({ kind: "removed" });
						},
					);
				}, debounceMs);
			});
			return {
				close() {
					if (timer) clearTimeout(timer);
					fileWatcher.close();
				},
			};
		},
	};
}

export const nodeTextFileWatchPort = createNodeTextFileWatchPort();
