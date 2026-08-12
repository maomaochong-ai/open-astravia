import type { PluginContext } from "@vetta-org/plugin-sdk";
import { strFromU8, unzipSync } from "fflate";
import { HISTORY_ENTRY, unpackHistoryFromShare } from "../history/history-transfer";
import { manifestPathOf } from "../vetd/manifest-types";
import { sanitizeDesignName } from "../vetd/scaffold";
import { repairPackagedSnapshot } from "./snapshot-repair";

export interface PackagedVetd {
	manifestJson: string;
	snapshotHtml: string | null;
	/** design-relative path → bytes */
	designFiles: Map<string, Uint8Array>;
	/** 打包好的版本历史。0.6.0 之前导出的包没有这一项。 */
	historyZip: Uint8Array | null;
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
		// 0.3.1 之前导出的快照可能被 `$&` 展开写坏，读回来时先还原（见 snapshot-repair）。
		snapshotHtml: entries["snapshot.html"] ? repairPackagedSnapshot(strFromU8(entries["snapshot.html"])) : null,
		designFiles,
		historyZip: entries[HISTORY_ENTRY] ?? null,
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
	// 历史在源码之后还原：`.history/` 里存的就是这些文件的旧版本，先落地内容再接上历史，
	// 之后第一次打开这份设计时不会因为「工作区与 HEAD 不一致」而多出一个空版本。
	if (packaged.historyZip) {
		await unpackHistoryFromShare(ctx, vetdPath, base64FromBytes(packaged.historyZip));
	}
	return vetdPath;
}
