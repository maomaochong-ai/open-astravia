/**
 * 老 `.vetdz` 的向后兼容：0.6.0 之前导出的分享包里没有 history.zip，导入必须照常，
 * 且不能因为「没有历史」多走一步还原。
 */
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parsePackagedVetd } from "../src/export/import-design";

function legacyPackage(): Uint8Array {
	return zipSync({
		"manifest.json": strToU8('{"version":1,"type":"vetta-design","frames":[]}'),
		"snapshot.html": strToU8("<html></html>"),
		"design/frames/index.tsx": strToU8("export default function Index(){return null}\n"),
	});
}

describe("老分享包", () => {
	it("没有 history.zip 时解析成 historyZip: null，其余照常", () => {
		const packaged = parsePackagedVetd(legacyPackage());
		expect(packaged.historyZip).toBeNull();
		expect(packaged.designFiles.get("frames/index.tsx")).toBeDefined();
		expect(packaged.snapshotHtml).toContain("<html>");
	});

	it("带 history.zip 的新包解析得出历史", () => {
		const withHistory = zipSync({
			"manifest.json": strToU8('{"version":1,"type":"vetta-design","frames":[]}'),
			"history.zip": strToU8("PK-fake"),
		});
		expect(parsePackagedVetd(withHistory).historyZip).not.toBeNull();
	});
});
