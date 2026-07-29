import assert from "node:assert/strict";
import test from "node:test";
import { extractReleaseNotes } from "./resolve-release-info.mjs";

test("extractReleaseNotes returns only the requested released section", () => {
	const changelog = `# Changelog

## [Unreleased]

- pending

## [1.2.3]

### Fixed

- fixed startup

## [1.2.2]

- older
`;

	assert.equal(extractReleaseNotes(changelog, "1.2.3"), "### Fixed\n\n- fixed startup");
});

test("extractReleaseNotes ignores unreleased notes when the version section is absent", () => {
	assert.equal(extractReleaseNotes("## [Unreleased]\n\n- pending\n", "1.2.3"), undefined);
});
