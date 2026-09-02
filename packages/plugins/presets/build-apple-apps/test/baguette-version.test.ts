import { describe, expect, it } from "vitest";
import {
	isBaguetteCompatible,
	MINIMUM_BAGUETTE_VERSION,
	parseBaguetteVersion,
} from "../src/runtime/baguette-version.js";

describe("parseBaguetteVersion", () => {
	it("reads the version out of CLI output", () => {
		expect(parseBaguetteVersion("0.1.97")).toBe("0.1.97");
		expect(parseBaguetteVersion("baguette 1.2.30\n")).toBe("1.2.30");
	});

	it("returns null when there is no version to read", () => {
		expect(parseBaguetteVersion("command not found")).toBeNull();
	});
});

describe("isBaguetteCompatible", () => {
	it("accepts the pinned minimum and anything newer", () => {
		expect(isBaguetteCompatible(MINIMUM_BAGUETTE_VERSION)).toBe(true);
		expect(isBaguetteCompatible("0.1.98")).toBe(true);
		expect(isBaguetteCompatible("0.2.0")).toBe(true);
		expect(isBaguetteCompatible("1.0.0")).toBe(true);
	});

	it("rejects older builds, whose gesture injection silently no-ops on iOS 26", () => {
		expect(isBaguetteCompatible("0.1.96")).toBe(false);
		expect(isBaguetteCompatible("0.0.99")).toBe(false);
	});

	it("fails closed when the version cannot be read", () => {
		expect(isBaguetteCompatible(null)).toBe(false);
		expect(isBaguetteCompatible("dev")).toBe(false);
		expect(isBaguetteCompatible("1.2")).toBe(false);
	});
});
