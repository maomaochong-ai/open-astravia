import { describe, expect, it } from "vitest";
import {
	InMemoryRuntimeSessionMarkerIndex,
	InMemoryRuntimeSessionValueIndex,
} from "../../src/runtime-host/session-resource-index.js";

describe("Runtime Session resource indexes", () => {
	it("rebinds and unbinds a value only when the registered identity matches", () => {
		const index = new InMemoryRuntimeSessionValueIndex<object>();
		const registered = {};
		const other = {};
		index.set("source", registered);

		index.rebind("source", "ignored", other);
		expect(index.get("source")).toBe(registered);
		expect(index.get("ignored")).toBeUndefined();

		index.rebind("source", "target", registered);
		expect(index.get("source")).toBeUndefined();
		expect(index.get("target")).toBe(registered);

		index.unbind("target", other);
		expect(index.get("target")).toBe(registered);
		index.unbind("target", registered);
		expect(index.get("target")).toBeUndefined();
	});

	it("moves markers only when the source Session is marked", () => {
		const index = new InMemoryRuntimeSessionMarkerIndex();
		index.rebind("missing", "ignored");
		expect(index.has("ignored")).toBe(false);

		index.add("source");
		index.rebind("source", "target");
		expect(index.has("source")).toBe(false);
		expect(index.has("target")).toBe(true);

		index.clear();
		expect(index.has("target")).toBe(false);
	});
});
