import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { changedFiles } from "./lib.mjs";

const PACKAGED_SMOKE_PATTERNS = [
	/^apps\/desktop\/(src\/main|src\/preload|scripts\/(prepare-pack\.js|desktop-build-environment\.mjs|mac-signing-config\.mjs|run-open-source-build\.mjs)|scripts\/desktop-packaging-layout\.mjs|scripts\/packaged-native-dependencies\.|vite\..*config\.|package\.json|wdio\.conf\.ts|e2e\/)/,
	/^packages\/(remote-control|remote-desktop)\//,
	/^bun\.lock$/,
	/^\.github\/workflows\/(quality|desktop-packaged)\.yml$/,
];

export function classifyDesktopPackagingRisk(paths) {
	const normalized = paths.map((path) => path.replaceAll("\\", "/"));
	const reasons = normalized.filter((path) => PACKAGED_SMOKE_PATTERNS.some((pattern) => pattern.test(path)));
	return {
		packagedSmokeRequired: reasons.length > 0,
		reasons: [...new Set(reasons)].sort(),
	};
}

function resolveBaseRef() {
	if (process.env.DESKTOP_PACKAGING_BASE_REF) return process.env.DESKTOP_PACKAGING_BASE_REF;
	if (process.env.GITHUB_EVENT_NAME === "pull_request" && process.env.GITHUB_BASE_REF) {
		return `origin/${process.env.GITHUB_BASE_REF}`;
	}
	if (
		process.env.GITHUB_EVENT_NAME === "push" &&
		process.env.GITHUB_EVENT_BEFORE &&
		!/^[0]+$/.test(process.env.GITHUB_EVENT_BEFORE)
	) {
		return process.env.GITHUB_EVENT_BEFORE;
	}
	if (process.env.GITHUB_SHA) return `${process.env.GITHUB_SHA}^`;
	return "origin/dev";
}

export function writeDesktopPackagingScopeOutput(result, outputPath = process.env.GITHUB_OUTPUT) {
	if (!outputPath) return;
	appendFileSync(outputPath, `packaged-smoke=${result.packagedSmokeRequired}\n`);
}

export function main() {
	const result = classifyDesktopPackagingRisk(changedFiles(resolveBaseRef()));
	console.log(
		`[desktop-packaging-scope] packaged smoke: ${result.packagedSmokeRequired ? "required" : "not required"}`,
	);
	if (result.reasons.length > 0) console.log(`[desktop-packaging-scope] reasons:\n${result.reasons.join("\n")}`);
	writeDesktopPackagingScopeOutput(result);
	return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
