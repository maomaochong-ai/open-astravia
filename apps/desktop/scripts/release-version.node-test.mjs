import assert from "node:assert/strict";
import test from "node:test";
import { desktopVersionInfoVersion, isDesktopReleaseVersion } from "./release-version.mjs";

test("accepts plain and pre-release desktop versions", () => {
	for (const version of ["0.5.64", "0.5.64-1", "0.5.64-3", "1.2.3", "12.34.56-78", "1.0.0-0"]) {
		assert.equal(isDesktopReleaseVersion(version), true, `expected ${version} to be accepted`);
	}
});

test("rejects values that are not desktop release versions", () => {
	for (const version of [
		undefined,
		null,
		123,
		"",
		"0.5",
		"0.5.64.1",
		"0.5.64-",
		"0.5.64-a",
		"0.5.64-1-2",
		"0.5.64 ",
		"v0.5.64",
		"1.2.3-beta.1",
	]) {
		assert.equal(isDesktopReleaseVersion(version), false, `expected ${String(version)} to be rejected`);
	}
});

test("folds desktop release versions into a four part VersionInfoVersion", () => {
	assert.equal(desktopVersionInfoVersion("0.5.64"), "0.5.64.0");
	assert.equal(desktopVersionInfoVersion("0.5.64-3"), "0.5.64.3");
	assert.equal(desktopVersionInfoVersion("1.2.3-12"), "1.2.3.12");
});

test("rejects versions that Inno Setup cannot express", () => {
	assert.throws(() => desktopVersionInfoVersion("0.5.64.1"), /invalid desktop release version/);
	assert.throws(() => desktopVersionInfoVersion(undefined), /invalid desktop release version/);
	assert.throws(() => desktopVersionInfoVersion("0.5.65536"), /exceeds the VersionInfoVersion range/);
	assert.throws(() => desktopVersionInfoVersion("0.5.64-65536"), /exceeds the VersionInfoVersion range/);
});
