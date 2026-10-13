import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { isDirectRun, repoRoot } from "../quality/lib.mjs";
import { desktopVersion, requireReleaseNotes } from "./release-notes.mjs";

const INSTALLER_EXTENSIONS = {
	desktop: new Set([".AppImage", ".blockmap", ".deb", ".dmg", ".exe", ".msi", ".rpm", ".zip"]),
	android: new Set([".apk"]),
};

function runGh(args) {
	const result = spawnSync("gh", args, { stdio: args[1] === "view" ? "ignore" : "inherit" });
	if (result.error) throw new Error(`Could not run GitHub CLI: ${result.error.message}`);
	return result.status === 0;
}

export function publishGithubInstallers({ version, sha, platform, directory, root = repoRoot, github = runGh }) {
	const notes = requireReleaseNotes(version, root);
	if (!/^[a-f0-9]{40}$/i.test(sha ?? "")) throw new Error("GITHUB_SHA must identify the release commit.");
	if (platform !== "desktop" && platform !== "android")
		throw new Error("Installer platform must be desktop or android.");
	const extensions = INSTALLER_EXTENSIONS[platform];
	const installers = readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && extensions.has(extname(entry.name)))
		.map((entry) => join(directory, entry.name))
		.sort();
	if (installers.length === 0) throw new Error(`No ${platform} installers found to publish.`);
	const tag = `v${version}`;
	if (!github(["release", "view", tag])) {
		// Platform jobs can finish together; another job may create the release first.
		if (
			!github([
				"release",
				"create",
				tag,
				"--notes-file",
				join(root, notes),
				"--title",
				`Vetta ${version}`,
				"--target",
				sha,
			]) &&
			!github(["release", "view", tag])
		) {
			throw new Error(`Could not create GitHub Release ${tag}.`);
		}
	}
	if (!github(["release", "upload", tag, ...installers, "--clobber"])) {
		throw new Error(`Could not upload ${platform} installers to ${tag}.`);
	}
	return installers;
}

if (isDirectRun(import.meta.url)) {
	try {
		const args = process.argv.slice(2);
		if (args.length !== 4 || args[0] !== "--platform" || args[2] !== "--directory") {
			throw new Error("Usage: publish-github-installers.mjs --platform <desktop|android> --directory <path>");
		}
		publishGithubInstallers({
			version: process.env.RELEASE_VERSION || desktopVersion(),
			sha: process.env.GITHUB_SHA,
			platform: args[1],
			directory: resolve(args[3]),
		});
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
