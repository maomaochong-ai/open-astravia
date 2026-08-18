import { describe, expect, it } from "vitest";
import { compareAppVersions, isAppVersionCompatible, isValidAppVersion } from "./marketplace-compatibility";

describe("marketplace app compatibility", () => {
	it("compares stable semantic versions", () => {
		expect(compareAppVersions("0.5.11", "0.5.10")).toBeGreaterThan(0);
		expect(compareAppVersions("0.5.11", "0.5.11")).toBe(0);
		expect(compareAppVersions("0.5.11", "0.6.0")).toBeLessThan(0);
	});

	it("handles prerelease versions according to semantic version precedence", () => {
		expect(compareAppVersions("0.6.0-beta.2", "0.6.0-beta.1")).toBeGreaterThan(0);
		expect(compareAppVersions("0.6.0", "0.6.0-beta.2")).toBeGreaterThan(0);
		expect(compareAppVersions("0.6.0-beta.1", "0.6.0")).toBeLessThan(0);
		expect(compareAppVersions("0.6.0-beta.100000000000000000000", "0.6.0-beta.99999999999999999999")).toBeGreaterThan(
			0,
		);
	});

	it("checks the required minimum app version", () => {
		expect(isAppVersionCompatible("0.5.11", "0.5.11")).toBe(true);
		expect(isAppVersionCompatible("0.5.11", "0.6.0")).toBe(false);
	});

	it("rejects malformed app versions", () => {
		expect(isValidAppVersion("0.5.11")).toBe(true);
		expect(isValidAppVersion("v0.5.11-beta.1+build.2")).toBe(true);
		expect(isValidAppVersion("0.5")).toBe(false);
		expect(isValidAppVersion("0.05.11")).toBe(false);
		expect(() => compareAppVersions("latest", "0.5.11")).toThrow("Invalid app version");
	});
});
