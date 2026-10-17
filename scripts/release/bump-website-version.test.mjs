import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WEBSITE_VERSION_FILES, bumpWebsiteVersion, readWebsiteVersion } from "./bump-website-version.mjs";

const roots = [];

const fixtures = {
	"website/index.html": [
		'<a href="https://dl.astravia.dev/app/v0.5.65/Astravia-0.5.65-arm64.dmg" class="dl">',
		'  <span class="dl__version">v0.5.65 · DMG</span>',
		"</a>",
		'<a href="https://dl.astravia.dev/app/v0.5.65/astravia_0.5.65_amd64.deb">deb</a>',
		"",
	].join("\n"),
	"website/src/download-links.ts": 'export const DOWNLOAD_VERSION = "0.5.65";\n',
	"website/package.json": '{\n\t"name": "astravia-website",\n\t"version": "0.5.65"\n}\n',
	"website/test/download-target.test.ts": 'const VERSION = "0.5.65";\nexport { VERSION };\n',
	"website/test/download-entry.test.ts": 'const VERSION = "0.5.65";\nexport { VERSION };\n',
};

function fixtureRoot(overrides = {}) {
	const root = mkdtempSync(join(tmpdir(), "astravia-website-version-"));
	roots.push(root);
	for (const [file, contents] of Object.entries({ ...fixtures, ...overrides })) {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		writeFileSync(join(root, file), contents);
	}
	return root;
}

function read(root, file) {
	return readFileSync(join(root, file), "utf8");
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("website download version", () => {
	it("reads the published version from the download links module", () => {
		expect(readWebsiteVersion(fixtureRoot())).toBe("0.5.65");
	});

	it("rewrites every file that carries the version", () => {
		const root = fixtureRoot();
		const result = bumpWebsiteVersion({ version: "0.5.66", root });

		expect(result).toEqual({ current: "0.5.65", changed: true, files: [...WEBSITE_VERSION_FILES] });
		for (const file of WEBSITE_VERSION_FILES) {
			expect(read(root, file)).toContain("0.5.66");
			expect(read(root, file)).not.toContain("0.5.65");
		}
		// 下载链接的目录和产物名都要跟着改，否则按钮指向不存在的对象。
		expect(read(root, "website/index.html")).toContain(
			"https://dl.astravia.dev/app/v0.5.66/Astravia-0.5.66-arm64.dmg",
		);
		expect(readWebsiteVersion(root)).toBe("0.5.66");
	});

	it("treats a re-run at the same version as a no-op", () => {
		const root = fixtureRoot();
		bumpWebsiteVersion({ version: "0.5.66", root });
		const before = WEBSITE_VERSION_FILES.map((file) => read(root, file));

		expect(bumpWebsiteVersion({ version: "0.5.66", root })).toEqual({
			current: "0.5.66",
			changed: false,
			files: [],
		});
		expect(WEBSITE_VERSION_FILES.map((file) => read(root, file))).toEqual(before);
	});

	it("rejects a version that is not a release version", () => {
		const root = fixtureRoot();
		for (const version of ["v0.5.66", "0.5", "latest", ""]) {
			expect(() => bumpWebsiteVersion({ version, root })).toThrow(/Invalid website version/);
		}
	});

	// 0.5.64 是 0.5.64-4 的前缀：首页里带后缀的版本说明官网同时引用了两个版本，停下来人工判断。
	it("refuses when the page references another version", () => {
		const root = fixtureRoot({
			"website/src/download-links.ts": 'export const DOWNLOAD_VERSION = "0.5.64";\n',
			"website/package.json": '{\n\t"version": "0.5.64"\n}\n',
			"website/test/download-target.test.ts": 'const VERSION = "0.5.64";\nexport { VERSION };\n',
			"website/test/download-entry.test.ts": 'const VERSION = "0.5.64";\nexport { VERSION };\n',
			"website/index.html": '<a href="https://dl.astravia.dev/app/v0.5.64-4/a.dmg">dmg</a>\n',
		});
		expect(() => bumpWebsiteVersion({ version: "0.5.66", root })).toThrow(
			/website\/index\.html references other versions \(0\.5\.64-4\)/,
		);
	});

	it("refuses when a file stopped carrying the current version", () => {
		const root = fixtureRoot({ "website/package.json": '{\n\t"version": "0.5.64"\n}\n' });
		expect(() => bumpWebsiteVersion({ version: "0.5.66", root })).toThrow(
			/website\/package\.json is at 0\.5\.64, but the website downloads 0\.5\.65/,
		);
	});
});
