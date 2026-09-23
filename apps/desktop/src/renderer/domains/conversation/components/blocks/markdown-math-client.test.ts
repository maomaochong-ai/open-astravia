import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderFormula } from "../../../../../../../../packages/theme-ui/src/markdown/math-render";

class ControlledWorker {
	static instances: ControlledWorker[] = [];
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onerror: (() => void) | null = null;
	requests: Array<{ id: number; source: string; display: boolean }> = [];
	terminated = false;
	constructor() {
		ControlledWorker.instances.push(this);
	}
	postMessage(request: { id: number; source: string; display: boolean }) {
		this.requests.push(request);
	}
	terminate() {
		this.terminated = true;
	}
	reply(html: string | null) {
		this.onmessage?.({ data: { id: this.requests.at(-1)?.id, html } });
	}
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.resetModules();
	ControlledWorker.instances = [];
	vi.stubGlobal("Worker", ControlledWorker);
});
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("formula rendering budget", () => {
	it("deduplicates formulas, serializes distinct jobs and serves completed results without worker work", async () => {
		const { requestFormula } = await import("../../../../../../../../packages/theme-ui/src/markdown/math-client");
		const first = vi.fn();
		const duplicate = vi.fn();
		const second = vi.fn();
		requestFormula("x", false, first);
		requestFormula("x", false, duplicate);
		requestFormula("y", true, second);
		const worker = ControlledWorker.instances[0];
		expect(worker.requests.map((request) => request.source)).toEqual(["x"]);
		worker.reply("<math>x</math>");
		expect(first).toHaveBeenCalledWith("<math>x</math>");
		expect(duplicate).toHaveBeenCalledWith("<math>x</math>");
		expect(worker.requests.map((request) => request.source)).toEqual(["x", "y"]);
		worker.reply("<math>y</math>");
		const cached = vi.fn();
		requestFormula("x", false, cached);
		expect(cached).toHaveBeenCalledWith("<math>x</math>");
		expect(worker.requests).toHaveLength(2);
		vi.advanceTimersByTime(30_000);
		expect(worker.terminated).toBe(true);
	});

	it("cancels abandoned jobs, ignores stale replies and recovers after a worker timeout", async () => {
		const { requestFormula } = await import("../../../../../../../../packages/theme-ui/src/markdown/math-client");
		const abandoned = vi.fn();
		const next = vi.fn();
		const cancel = requestFormula("old", false, abandoned);
		requestFormula("next", false, next);
		const old = ControlledWorker.instances[0];
		cancel();
		expect(old.terminated).toBe(true);
		old.reply("stale");
		old.onerror?.();
		expect(next).not.toHaveBeenCalled();
		expect(ControlledWorker.instances.at(-1)?.terminated).toBe(false);
		vi.advanceTimersByTime(2000);
		expect(next).toHaveBeenCalledWith(null);
		expect(abandoned).not.toHaveBeenCalled();
		const recovered = vi.fn();
		requestFormula("recovered", true, recovered);
		ControlledWorker.instances.at(-1)?.reply("<math>ok</math>");
		expect(recovered).toHaveBeenCalledWith("<math>ok</math>");
	});

	it("bounds formulas and macro expansion while keeping unsafe commands inert", () => {
		expect(renderFormula("x".repeat(8193), false)).toBeNull();
		expect(renderFormula("\\def\\a{\\a}\\a", false)).toBeNull();
		expect(renderFormula("\\href{javascript:alert(1)}{click}", false)).not.toContain("href=");
		expect(renderFormula("\\gdef\\secret{hello}\\secret", false)).toContain("hello");
		expect(renderFormula("\\secret", false)).toBeNull();
	});
});
