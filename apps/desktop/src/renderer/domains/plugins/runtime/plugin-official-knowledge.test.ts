import { afterEach, describe, expect, it, vi } from "vitest";
import { createOfficialKnowledgeApi } from "./plugin-official-knowledge.js";

afterEach(() => {
	Reflect.deleteProperty(globalThis, "window");
});

describe("createOfficialKnowledgeApi", () => {
	it("uses the plugin capability session and preserves facade defaults", async () => {
		const knowledge = {
			listBases: vi.fn().mockResolvedValue([]),
			addFiles: vi.fn().mockResolvedValue(undefined),
			setProcessing: vi.fn().mockResolvedValue({ enabled: true }),
		};
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { vetta: { plugins: { internalCapabilities: { knowledge } } } },
		});
		const assertOfficial = vi.fn();
		const api = createOfficialKnowledgeApi(assertOfficial, "capability-session");

		await expect(api.list()).resolves.toEqual([]);
		await expect(api.addFiles("default_kb", ["C:/source.txt"])).resolves.toBeUndefined();
		await expect(api.setProcessing({ processingModelKey: null })).resolves.toEqual({ enabled: true });

		expect(assertOfficial).toHaveBeenCalledTimes(3);
		expect(knowledge.listBases).toHaveBeenCalledWith("capability-session");
		expect(knowledge.addFiles).toHaveBeenCalledWith("capability-session", "default_kb", ["C:/source.txt"], false);
		expect(knowledge.setProcessing).toHaveBeenCalledWith("capability-session", {
			processingModelKey: null,
		});
	});
});
