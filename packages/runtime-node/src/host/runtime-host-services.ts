import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { RuntimeHostPathServices, RuntimeQueueSidecarStore } from "@vetta/runtime-core";

function queueSidecarPath(sessionPath: string): string {
	return `${sessionPath}.queue.json`;
}

export const nodeRuntimeHostPathServices: RuntimeHostPathServices = {
	normalize: resolve,
	ensureDirectory: (path) => mkdir(path, { recursive: true }).then(() => undefined),
};

export const nodeRuntimeQueueSidecarStore: RuntimeQueueSidecarStore = {
	async read(sessionPath) {
		const raw = await readFile(queueSidecarPath(sessionPath), "utf8");
		return JSON.parse(raw) as unknown;
	},
	async write(sessionPath, snapshot) {
		await writeFile(queueSidecarPath(sessionPath), JSON.stringify(snapshot), "utf8");
	},
	async remove(sessionPath) {
		await rm(queueSidecarPath(sessionPath), { force: true });
	},
};
