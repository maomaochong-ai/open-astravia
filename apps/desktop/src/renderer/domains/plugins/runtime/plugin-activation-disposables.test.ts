import { describe, expect, it, vi } from "vitest";
import { trackActivationDisposable } from "./plugin-activation-disposables";

describe("trackActivationDisposable", () => {
	it("releases an activation-owned subscription exactly once", () => {
		const dispose = vi.fn();
		const disposers: Array<() => void> = [];
		const tracked = trackActivationDisposable({ dispose }, disposers);

		expect(disposers).toHaveLength(1);
		disposers[0]?.();
		tracked.dispose();

		expect(dispose).toHaveBeenCalledOnce();
	});
});
