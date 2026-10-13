import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	parseAndroidReleaseConfig,
	parseAndroidVersion,
	prepareAndroidRelease,
	stageAndroidApk,
} from "./prepare-android-release.mjs";
import { publishGithubInstallers } from "./publish-github-installers.mjs";

const abi = "arm64-v8a";

const directories = [];
afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "vetta-android-release-test-"));
	directories.push(directory);
	return {
		RUNNER_TEMP: directory,
		VETTA_ANDROID_KEYSTORE_BASE64: Buffer.from("test keystore").toString("base64"),
		VETTA_ANDROID_KEYSTORE_PASSWORD: "test-store-password",
		VETTA_ANDROID_KEY_ALIAS: "test-alias",
		VETTA_ANDROID_KEY_PASSWORD: "test-key-password",
	};
}
function apkMetadata(versionName, versionCode, overrides = {}) {
	return {
		applicationId: "org.vetta.android",
		variantName: "release",
		elements: [
			{
				versionName,
				versionCode,
				filters: [{ filterType: "ABI", value: abi }],
				outputFile: `androidApp-${abi}-release.apk`,
			},
		],
		...overrides,
	};
}

function writeApk(directory) {
	writeFileSync(join(directory, `androidApp-${abi}-release.apk`), `built ${abi} APK`);
}

function badElement(overrides) {
	const metadata = apkMetadata("1.0", 1);
	Object.assign(metadata.elements[0], overrides);
	return metadata;
}

describe("Android desktop release flow", () => {
	it("prepares the fixed key and appends the arm64 APK with its own version to the desktop release", () => {
		const secrets = fixture();
		const config = parseAndroidReleaseConfig(
			`vettaAndroidVersionName=1.0\nvettaAndroidVersionCode=1\nvettaAndroidAbi=${abi}\n`,
		);
		const build = prepareAndroidRelease({ ...secrets, RELEASE_VERSION: "0.5.62" });
		expect(readFileSync(build.VETTA_ANDROID_KEYSTORE_PATH, "utf8")).toBe("test keystore");
		expect(build).not.toHaveProperty("VETTA_ANDROID_VERSION_NAME");
		expect(build).not.toHaveProperty("VETTA_ANDROID_VERSION_CODE");
		expect(JSON.stringify(build)).not.toContain("password");
		writeFileSync(join(secrets.RUNNER_TEMP, "output-metadata.json"), JSON.stringify(apkMetadata("1.0", 1)));
		writeApk(secrets.RUNNER_TEMP);
		const staged = stageAndroidApk(secrets.RUNNER_TEMP, { ...secrets, ...build }, config);
		expect(staged).toBe(join(secrets.RUNNER_TEMP, "android-release", "Vetta-arm64-v8a.apk"));
		expect(readFileSync(staged, "utf8")).toBe(`built ${abi} APK`);
		const uploaded = [];
		publishGithubInstallers({
			version: "0.5.62",
			sha: "a".repeat(40),
			platform: "android",
			directory: join(secrets.RUNNER_TEMP, "android-release"),
			github: ([, operation, tag, ...args]) => {
				expect(tag).toBe("v0.5.62");
				if (operation === "upload") uploaded.push(...args.filter((arg) => arg !== "--clobber"));
				return true;
			},
		});
		expect(uploaded).toEqual([staged]);
		const rebuilt = prepareAndroidRelease({ ...secrets, RELEASE_VERSION: "0.5.63" });
		expect(readFileSync(rebuilt.VETTA_ANDROID_KEYSTORE_PATH)).toEqual(
			readFileSync(build.VETTA_ANDROID_KEYSTORE_PATH),
		);
		expect(rebuilt.VETTA_ANDROID_APK_PATH).toBe(build.VETTA_ANDROID_APK_PATH);
	});
	it.each([
		"VETTA_ANDROID_KEYSTORE_BASE64",
		"VETTA_ANDROID_KEYSTORE_PASSWORD",
		"VETTA_ANDROID_KEY_ALIAS",
		"VETTA_ANDROID_KEY_PASSWORD",
	])("rejects a release missing %s instead of using a new or debug key", (key) => {
		const secrets = fixture();
		delete secrets[key];
		expect(() => prepareAndroidRelease(secrets)).toThrow(`Missing Android signing secrets: ${key}`);
	});
	it.each(["0", "-1", "1.5", "2100000001", "invalid"])("rejects unsupported Android version code %s", (code) => {
		expect(() => parseAndroidVersion(`vettaAndroidVersionName=1.0\nvettaAndroidVersionCode=${code}`)).toThrow(
			"Invalid Android versionCode",
		);
	});
	it("requires one authoritative Android version declaration", () => {
		expect(() => parseAndroidVersion("vettaAndroidVersionName=1.0")).toThrow("exactly once");
		expect(() =>
			parseAndroidVersion("vettaAndroidVersionName=1.0\nvettaAndroidVersionCode=1\nvettaAndroidVersionCode=2"),
		).toThrow("exactly once");
		expect(() => parseAndroidVersion("vettaAndroidVersionName=\nvettaAndroidVersionCode=1")).toThrow(
			"Invalid Android versionName",
		);
	});
	it.each(["", "arm64-v8a,arm64-v8a", "armeabi-v7a", "x86", "x86_64"])(
		"rejects unsupported ABI configuration %s",
		(abiName) => {
			expect(() =>
				parseAndroidReleaseConfig(
					`vettaAndroidVersionName=1.0\nvettaAndroidVersionCode=1\nvettaAndroidAbi=${abiName}`,
				),
			).toThrow("Invalid Android release ABI");
		},
	);

	it("rejects a malformed key without echoing its contents", () => {
		const secrets = { ...fixture(), VETTA_ANDROID_KEYSTORE_BASE64: "private-invalid-payload" };
		expect(() => prepareAndroidRelease(secrets)).toThrow("is not valid base64");
	});
	it("rejects environment paths that could inject GitHub environment values", () => {
		expect(() => prepareAndroidRelease({ ...fixture(), RUNNER_TEMP: "/tmp/path\nINJECTED=true" })).toThrow(
			"single-line path",
		);
	});
	it.each([
		apkMetadata("0.9", 1),
		apkMetadata("1.0", 2),
		apkMetadata("1.0", 1, { variantName: "debug" }),
		apkMetadata("1.0", 1, { applicationId: "another.app" }),
		apkMetadata("1.0", 1, { elements: [] }),
		apkMetadata("1.0", 1, { elements: [...apkMetadata("1.0", 1).elements, ...apkMetadata("1.0", 1).elements] }),
		badElement({ outputFile: "../outside.apk" }),
		badElement({ filters: [] }),
		badElement({ filters: [{ filterType: "ABI", value: "mips" }] }),
		badElement({ filters: [{ filterType: "ABI", value: "x86" }] }),
		badElement({ filters: [{ filterType: "DENSITY", value: "arm64-v8a" }] }),
	])("refuses to publish a stale, debug, or unexpected APK", (metadata) => {
		const secrets = fixture();
		const build = prepareAndroidRelease(secrets);
		writeFileSync(join(secrets.RUNNER_TEMP, "output-metadata.json"), JSON.stringify(metadata));
		writeApk(secrets.RUNNER_TEMP);
		expect(() => stageAndroidApk(secrets.RUNNER_TEMP, { ...secrets, ...build })).toThrow("does not match");
	});
});
