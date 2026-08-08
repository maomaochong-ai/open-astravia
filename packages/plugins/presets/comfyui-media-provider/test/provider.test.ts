import type {
	PluginContext,
	PluginMediaInputUploadRequest,
	PluginMediaProviderHandlerContext,
	PluginMediaTransferResponse,
	PluginNetworkApi,
	PluginNetworkRequest,
	PluginNetworkResponse,
} from "@vetta-org/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { createComfyUiProvider } from "../src/provider";
import type { ComfyPrompt } from "../src/workflow-adapter";

const template: ComfyPrompt = {
	load: { class_type: "LoadImage", inputs: { image: "old.png" } },
	resolution: { class_type: "ResolutionSelector", inputs: { aspect_ratio: "1:1 (Square)" } },
	duration: { class_type: "PrimitiveFloat", inputs: { value: 5 }, _meta: { title: "Float (duration)" } },
	generate: { class_type: "MiniMaxH3ImageToVideo", inputs: { prompt: "old" } },
	save: { class_type: "SaveVideo", inputs: {} },
};

function response<T>(body: T): PluginNetworkResponse<T> {
	return { ok: true, status: 200, statusText: "OK", headers: {}, body };
}

describe("ComfyUI media provider", () => {
	it("keeps ComfyUI workflow details behind the generic media provider request", async () => {
		let submittedPrompt: ComfyPrompt | undefined;
		let completed = false;
		const networkRequest = vi.fn(async (request: PluginNetworkRequest): Promise<PluginNetworkResponse<unknown>> => {
			if (request.url.endsWith("/history?max_items=20")) {
				return response({ template: { prompt: [0, "template", template], status: { status_str: "success" } } });
			}
			if (request.url.endsWith("/prompt")) {
				const body = request.body?.type === "json" ? request.body.value : undefined;
				submittedPrompt = (body as { prompt?: ComfyPrompt } | undefined)?.prompt;
				return response({ prompt_id: "job-1" });
			}
			if (request.url.endsWith("/history/job-1")) {
				return response(
					completed
						? {
								"job-1": {
									status: { status_str: "success" },
									outputs: {
										save: {
											images: [{ filename: "MiniMax_H3.mp4", subfolder: "video", type: "output" }],
										},
									},
								},
							}
						: {},
				);
			}
			if (request.url.endsWith("/queue")) {
				return response({ queue_running: [], queue_pending: [[1, "job-1"]] });
			}
			throw new Error(`Unexpected request: ${request.url}`);
		});
		const ctx = {
			network: { request: networkRequest as PluginNetworkApi["request"] },
			settings: { get: (key: string) => (key === "baseUrl" ? "http://comfy.local:8188" : undefined) },
			i18n: { t: () => "ComfyUI · MiniMax H3" },
		} as unknown as PluginContext;
		const uploadInputMock = vi.fn();
		const uploadInput = async <T = unknown>(
			inputId: string,
			request: PluginMediaInputUploadRequest,
		): Promise<PluginMediaTransferResponse<T>> => {
			uploadInputMock(inputId, request);
			return response({ name: "input.png", subfolder: "uploads" }) as PluginMediaTransferResponse<T>;
		};
		const context: PluginMediaProviderHandlerContext = { invocationId: "invocation-1", uploadInput };
		const provider = createComfyUiProvider(ctx);

		const queued = await provider.submit(
			{
				operation: "generate",
				kind: "video",
				mode: "image-to-video",
				prompt: "a slow camera move",
				aspectRatio: "16:9",
				durationSeconds: 10,
				inputs: [{ id: "input-1", kind: "image", mimeType: "image/png" }],
			},
			context,
		);

		expect(queued).toEqual({ id: "job-1", status: "queued" });
		const historyRequest = networkRequest.mock.calls
			.map(([request]) => request)
			.find((request) => request.url.endsWith("/history?max_items=20"));
		expect(historyRequest).toMatchObject({ method: "GET" });
		expect(historyRequest).not.toHaveProperty("body");
		expect(uploadInputMock).toHaveBeenCalledWith("input-1", {
			url: "http://comfy.local:8188/upload/image",
			fieldName: "image",
			fields: { overwrite: "true", type: "input" },
		});
		expect(submittedPrompt?.load.inputs.image).toBe("uploads/input.png");
		expect(submittedPrompt?.generate.inputs.prompt).toBe("a slow camera move");
		expect(submittedPrompt?.resolution.inputs.aspect_ratio).toBe("16:9 (Widescreen)");
		expect(submittedPrompt?.duration.inputs.value).toBe(10);

		completed = true;
		await expect(provider.getJob?.("job-1", context)).resolves.toEqual({
			id: "job-1",
			status: "succeeded",
			artifacts: [
				{
					kind: "video",
					mimeType: "video/mp4",
					source: {
						type: "remote-url",
						url: "http://comfy.local:8188/view?filename=MiniMax_H3.mp4&subfolder=video&type=output",
					},
				},
			],
		});
	});
});
