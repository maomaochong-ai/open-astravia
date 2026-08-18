import { describe, expect, it, vi } from "vitest";
import { createHostAccessGate } from "./host-access";

describe("createHostAccessGate", () => {
	it("protects nested functions until the host claims the token", () => {
		const run = vi.fn((value: string) => `ran:${value}`);
		const gate = createHostAccessGate({ nested: { run } });
		const protectedRun = gate.api.nested.run as unknown as (token: string, value: string) => string;

		expect(() => protectedRun("wrong-token", "value")).toThrow("Host API access denied");
		const token = gate.hostAccess.claim();
		expect(protectedRun(token, "value")).toBe("ran:value");
		expect(run).toHaveBeenCalledWith("value");
	});

	it("allows claiming the token only once", () => {
		const gate = createHostAccessGate({});

		gate.hostAccess.claim();

		expect(() => gate.hostAccess.claim()).toThrow("already been claimed");
	});

	it("does not mutate the raw API object", () => {
		const rawApi = { value: 1, nested: { enabled: true } };
		const gate = createHostAccessGate(rawApi);

		expect(gate.api).not.toBe(rawApi);
		expect(gate.api.nested).not.toBe(rawApi.nested);
		expect(rawApi).toEqual({ value: 1, nested: { enabled: true } });
	});
});
