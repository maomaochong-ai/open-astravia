import type { IpcRenderer, WebUtils } from "electron";
import { describe, expect, it, vi } from "vitest";
import { FS_READ_TEXT_PREVIEW_CHANNEL } from "../fs-types";
import { createSystemApi } from "./system";

describe("createSystemApi fs preview contract", () => {
	it("invokes the shared text-preview channel with the selected path", async () => {
		const invoke = vi.fn(async () => ({ status: "text", content: "preview", size: 7 }));
		const api = createSystemApi({ invoke } as unknown as IpcRenderer, {} as WebUtils);

		await expect(api.fs.readTextPreviewFile("C:\\workspace\\notes.custom")).resolves.toEqual({
			status: "text",
			content: "preview",
			size: 7,
		});
		expect(invoke).toHaveBeenCalledWith(FS_READ_TEXT_PREVIEW_CHANNEL, "C:\\workspace\\notes.custom");
	});
});
