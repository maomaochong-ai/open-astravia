import { describe, expect, it, vi } from "vitest";
import { createCodingAgentCompactionExtensionRuntime } from "../../src/adapters/extensions/compaction-extension-adapter.js";
import type { CompactionPreparation } from "../../src/compaction/index.js";
import type { ExtensionRunner } from "../../src/extensions/index.js";
import type { CodingAgentCompactionEntry } from "../../src/sessions/index.js";

type CompactionRunner = Pick<ExtensionRunner, "emit" | "hasHandlers">;

describe("createCodingAgentCompactionExtensionRuntime", () => {
	it("reads the active runner for every compaction phase", async () => {
		const first = createRunner();
		const second = createRunner();
		let current: CompactionRunner | undefined = first.runner;
		const runtime = createCodingAgentCompactionExtensionRuntime(() => current);
		const beforeInput = {
			preparation: {} as CompactionPreparation,
			branchEntries: [],
			signal: AbortSignal.abort(),
		};
		const afterInput = {
			compactionEntry: {} as CodingAgentCompactionEntry,
			fromExtension: true,
		};

		await expect(runtime.beforeCompaction(beforeInput)).resolves.toEqual({ cancel: true });
		await runtime.afterCompaction(afterInput);
		current = second.runner;
		await expect(runtime.beforeCompaction(beforeInput)).resolves.toEqual({ cancel: true });
		await runtime.afterCompaction(afterInput);
		current = undefined;
		await expect(runtime.beforeCompaction(beforeInput)).resolves.toBeUndefined();
		await expect(runtime.afterCompaction(afterInput)).resolves.toBeUndefined();

		expect(first.events).toEqual(["session_before_compact", "session_compact"]);
		expect(second.events).toEqual(["session_before_compact", "session_compact"]);
	});
});

function createRunner(): { readonly runner: CompactionRunner; readonly events: string[] } {
	const events: string[] = [];
	return {
		events,
		runner: {
			hasHandlers: vi.fn(() => true),
			emit: vi.fn(async (event: { readonly type: string }) => {
				events.push(event.type);
				return event.type === "session_before_compact" ? { cancel: true } : undefined;
			}),
		} as unknown as CompactionRunner,
	};
}
