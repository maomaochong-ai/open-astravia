import { access, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { main as verifyInnoUpdate } from "./verify-inno-update.mjs";
import { main as verifyLinuxUpdates } from "./verify-linux-update.mjs";
import { main as verifyMacUpdate } from "./verify-mac-update.mjs";

const releaseDir = resolve(import.meta.dirname, "../release");

async function exists(filePath) {
	return access(filePath).then(
		() => true,
		() => false,
	);
}

const hasWindowsMetadata = await exists(join(releaseDir, "latest.yml"));
const hasMacMetadata = await exists(join(releaseDir, "latest-mac.yml"));
const releaseFiles = await readdir(releaseDir).catch((error) => {
	if (error?.code === "ENOENT") return [];
	throw error;
});
const hasLinuxMetadata = releaseFiles.some((fileName) =>
	/^latest-linux(?:-[a-z0-9_-]+)?\.ya?ml$/i.test(fileName),
);

if (!hasWindowsMetadata && !hasMacMetadata && !hasLinuxMetadata) {
	throw new Error("[verify-update-artifacts] no desktop update metadata found");
}
if (hasWindowsMetadata) {
	if (process.platform === "win32") await verifyInnoUpdate();
	else {
		console.info(
			"[verify-update-artifacts] Windows runtime verification skipped on this platform; run verify:updates:windows on Windows",
		);
	}
}
if (hasMacMetadata) await verifyMacUpdate();
if (hasLinuxMetadata) await verifyLinuxUpdates();
