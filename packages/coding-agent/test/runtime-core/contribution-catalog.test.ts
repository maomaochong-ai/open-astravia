import { describe, expect, it } from "vitest";
import { DynamicContributionCatalog } from "../../src/interception/contribution-catalog.js";

describe("DynamicContributionCatalog", () => {
	it("returns stable ordered snapshots", () => {
		const catalog = new DynamicContributionCatalog<string>();
		catalog.register({ sourceId: "z", localId: "b", revision: "1", order: 20, value: "z/b" });
		catalog.register({ sourceId: "a", localId: "b", revision: "1", order: 10, value: "a/b" });
		catalog.register({ sourceId: "a", localId: "a", revision: "1", order: 10, value: "a/a" });

		expect(catalog.snapshot().map(({ value }) => value)).toEqual(["a/a", "a/b", "z/b"]);
	});

	it("does not let a stale lease remove a replacement", () => {
		const catalog = new DynamicContributionCatalog<string>();
		const stale = catalog.register({ sourceId: "plugin", localId: "guard", revision: "1", order: 1, value: "old" });
		const current = catalog.register({
			sourceId: "plugin",
			localId: "guard",
			revision: "2",
			order: 1,
			value: "new",
		});

		stale.release();
		expect(catalog.snapshot().map(({ value }) => value)).toEqual(["new"]);
		current.release();
		expect(catalog.snapshot()).toEqual([]);
	});

	it("atomically replaces and generation-safely releases a source", () => {
		const catalog = new DynamicContributionCatalog<string>();
		const stale = catalog.replaceSource("plugin", "1", [
			{ localId: "before", order: 1, value: "old-before" },
			{ localId: "after", order: 1, value: "old-after" },
		]);
		const current = catalog.replaceSource("plugin", "2", [{ localId: "before", order: 1, value: "new-before" }]);

		expect(catalog.snapshot().map(({ value }) => value)).toEqual(["new-before"]);
		stale.release();
		expect(catalog.snapshot().map(({ value }) => value)).toEqual(["new-before"]);
		current.release();
		expect(catalog.snapshot()).toEqual([]);
	});

	it("keeps an in-flight snapshot stable", () => {
		const catalog = new DynamicContributionCatalog<string>();
		const lease = catalog.register({ sourceId: "plugin", localId: "guard", revision: "1", order: 1, value: "old" });
		const inFlight = catalog.snapshot();
		lease.release();
		catalog.register({ sourceId: "plugin", localId: "guard", revision: "2", order: 1, value: "new" });

		expect(inFlight.map(({ value }) => value)).toEqual(["old"]);
		expect(catalog.snapshot().map(({ value }) => value)).toEqual(["new"]);
	});
});
