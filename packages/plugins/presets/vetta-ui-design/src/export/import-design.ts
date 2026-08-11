import type { PluginContext } from "@vetta-org/plugin-sdk";
import { strFromU8, unzipSync } from "fflate";
import { manifestPathOf } from "../vetd/manifest-types";
import { sanitizeDesignName } from "../vetd/scaffold";

export interface PackagedVetd {
	manifestJson: string;
	snapshotHtml: string | null;
	/** design-relative path → bytes */
	designFiles: Map<string, Uint8Array>;
}

export function parsePackagedVetd(bytes: Uint8Array): PackagedVetd {
	const entries = unzipSync(bytes);
	const manifest = entries["manifest.json"];
	if (!manifest) throw new Error("share file missing manifest.json");
	const designFiles = new Map<string, Uint8Array>();
	for (const [name, content] of Object.entries(entries)) {
		if (name.startsWith("design/") && !name.endsWith("/")) {
			designFiles.set(name.slice("design/".length), content);
		}
	}
	return {
		manifestJson: strFromU8(manifest),
		snapshotHtml: entries["snapshot.html"] ? strFromU8(entries["snapshot.html"]) : null,
		designFiles,
	};
}

function base64FromBytes(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

/**
 * Unpack a share file into a working design bundle (`x.vetd/`) inside
 * `targetDir`. Returns the new bundle path.
 */
export async function importPackagedVetd(
	ctx: PluginContext,
	packaged: PackagedVetd,
	targetDir: string,
	sourceFileName: string,
): Promise<string> {
	const baseName = sanitizeDesignName(sourceFileName.replace(/\.(?:vetdz|vetd)$/i, "").replace(/-share$/i, ""));
	let vetdPath = `${targetDir}/${baseName}.vetd`;
	let suffix = 1;
	while ((await ctx.fs.stat(vetdPath)) !== null) {
		vetdPath = `${targetDir}/${baseName}-${suffix}.vetd`;
		suffix += 1;
	}
	for (const [rel, bytes] of packaged.designFiles) {
		await ctx.fs.writeFile(`${vetdPath}/${rel}`, base64FromBytes(bytes), "base64");
	}
	await ctx.fs.writeFile(manifestPathOf(vetdPath), packaged.manifestJson);
	return vetdPath;
}
