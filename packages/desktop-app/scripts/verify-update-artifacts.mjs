import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { main as verifyInnoUpdate } from "./verify-inno-update.mjs";
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

if (!hasWindowsMetadata && !hasMacMetadata) {
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
