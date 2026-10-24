import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publishGithubInstallers } from "./publish-github-installers.mjs";

const directories = [];
afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function releaseFixture(files = []) {
	const root = mkdtempSync(join(tmpdir(), "astravia-github-installers-test-"));
	directories.push(root);
	mkdirSync(join(root, ".github/release-notes"), { recursive: true });
	writeFileSync(join(root, ".github/release-notes/v0.5.62.md"), "# Astravia 0.5.62\nRelease body");
	const directory = join(root, "installers");
	mkdirSync(directory);
	for (const file of files) writeFileSync(join(directory, file), file);
	return { root, directory, version: "0.5.62", sha: "a".repeat(40) };
}

describe("publish GitHub installers", () => {
	it("creates the desktop release then appends the matching Android APK to the same tag", () => {
		const fixture = releaseFixture(["Astravia-0.5.62.exe", "Astravia-arm64-v8a.apk", "latest.yml"]);
		const releases = new Map();
		const github = ([, operation, tag, ...args]) => {
			if (operation === "view") return releases.has(tag);
			if (operation === "create") {
				expect(args).toContain(join(fixture.root, ".github/release-notes/v0.5.62.md"));
				expect(args).toContain(fixture.sha);
				releases.set(tag, []);
			} else if (operation === "upload") {
				releases.get(tag).push(...args.filter((arg) => arg !== "--clobber"));
			}
			return true;
		};
		publishGithubInstallers({ ...fixture, platform: "desktop", github });
		publishGithubInstallers({ ...fixture, platform: "android", github });
		expect([...releases]).toEqual([
			["v0.5.62", [join(fixture.directory, "Astravia-0.5.62.exe"), join(fixture.directory, "Astravia-arm64-v8a.apk")]],
		]);
	});
	// iOS 包与 Android 同属「手机端产物」：不附桌面版本号，进同一个 v<版本> Release。
	it("appends the IPA to the same tag and ignores non-installer files", () => {
		const fixture = releaseFixture(["Astravia-ios.ipa", "manifest.plist", "Astravia.xcarchive"]);
		const releases = new Map();
		const github = ([, operation, tag, ...args]) => {
			if (operation === "view") return releases.has(tag);
			if (operation === "create") {
				releases.set(tag, []);
			} else if (operation === "upload") {
				releases.get(tag).push(...args.filter((arg) => arg !== "--clobber"));
			}
			return true;
		};
		expect(publishGithubInstallers({ ...fixture, platform: "ios", github })).toEqual([
			join(fixture.directory, "Astravia-ios.ipa"),
		]);
	});

	it("rejects an unknown installer platform instead of publishing nothing", () => {
		const fixture = releaseFixture(["Astravia-ios.ipa"]);
		expect(() => publishGithubInstallers({ ...fixture, platform: "watchos", github: () => true })).toThrow(
			"desktop, android or ios",
		);
	});

	it("recovers when another platform creates the release concurrently", () => {
		const fixture = releaseFixture(["Astravia-arm64-v8a.apk"]);
		let created = false;
		const github = ([, operation]) => {
			if (operation === "view") return created;
			if (operation === "create") {
				created = true;
				return false;
			}
			return true;
		};
		expect(publishGithubInstallers({ ...fixture, platform: "android", github })).toEqual([
			join(fixture.directory, "Astravia-arm64-v8a.apk"),
		]);
	});
	it("fails clearly when GitHub cannot create or upload the release", () => {
		const fixture = releaseFixture(["app.apk"]);
		expect(() => publishGithubInstallers({ ...fixture, platform: "android", github: () => false })).toThrow(
			"Could not create",
		);
		expect(() =>
			publishGithubInstallers({ ...fixture, platform: "android", github: ([, operation]) => operation === "view" }),
		).toThrow("Could not upload");
	});
	it("refuses an empty installer set before creating a release", () => {
		const fixture = releaseFixture(["latest.yml"]);
		expect(() =>
			publishGithubInstallers({
				...fixture,
				platform: "android",
				github: () => {
					throw new Error("must not publish");
				},
			}),
		).toThrow("No android installers");
	});
});
