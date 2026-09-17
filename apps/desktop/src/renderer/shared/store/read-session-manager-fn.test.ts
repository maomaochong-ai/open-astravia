// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSessionManagerFn } from "./chat-atoms";

describe("readSessionManagerFn", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns the mounted function without logging", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const fn = async () => undefined;
		expect(readSessionManagerFn({ current: fn }, "sendMessage")).toBe(fn);
		expect(error).not.toHaveBeenCalled();
	});

	it("logs which function is missing instead of failing silently", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		expect(readSessionManagerFn({ current: null }, "sendMessage")).toBeNull();
		expect(error).toHaveBeenCalledOnce();
		expect(String(error.mock.calls[0]?.[0])).toContain("sendMessage");
	});
});
