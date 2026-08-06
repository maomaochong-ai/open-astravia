import { describe, expect, it } from "vitest";
import { createNativeDragFilePayload } from "./native-file-drag";

describe("createNativeDragFilePayload", () => {
	it("uses only the Electron single-file field for one path", () => {
		expect(createNativeDragFilePayload(["C:\\project\\report.txt"])).toEqual({
			file: "C:\\project\\report.txt",
		});
	});

	it("uses the multi-file field only when multiple paths are present", () => {
		const paths = ["C:\\project\\one.txt", "C:\\project\\two.txt"];
		expect(createNativeDragFilePayload(paths)).toEqual({
			file: paths[0],
			files: paths,
		});
	});

	it("rejects an empty drag payload", () => {
		expect(() => createNativeDragFilePayload([])).toThrow("Native drag requires at least one file");
	});
});
