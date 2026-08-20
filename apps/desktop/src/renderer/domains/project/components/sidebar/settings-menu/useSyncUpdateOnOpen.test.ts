// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSyncUpdateOnOpen } from "./useSettingsMenuModel";

function stubUpdaterSync(sync: () => Promise<void>): void {
	Reflect.set(window, "vetta", { updater: { sync } });
}

describe("useSyncUpdateOnOpen", () => {
	afterEach(() => {
		Reflect.deleteProperty(window, "vetta");
	});

	it("syncs when the settings menu opens", () => {
		const sync = vi.fn(async () => {});
		stubUpdaterSync(sync);

		useSyncUpdateOnOpen()(true);

		expect(sync).toHaveBeenCalledTimes(1);
	});

	it("does not sync when the settings menu closes", () => {
		const sync = vi.fn(async () => {});
		stubUpdaterSync(sync);

		useSyncUpdateOnOpen()(false);

		expect(sync).not.toHaveBeenCalled();
	});
});
