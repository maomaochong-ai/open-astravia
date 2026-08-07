import type {
	PluginContext,
	PluginMediaProviderJob,
	PluginMediaProviderRegistration,
} from "@vetta-org/plugin-sdk";
import { ComfyUiClient, outputFile } from "./comfyui-client";
import { adaptMinimaxWorkflow } from "./workflow-adapter";

const outputNodes = new Map<string, string>();

function providerFailure(id: string, message: string): PluginMediaProviderJob {
	return {
		id,
		status: "failed",
		error: { code: "provider-failed", message, retryable: true },
	};
}

export function createComfyUiProvider(ctx: PluginContext): PluginMediaProviderRegistration {
	const client = new ComfyUiClient(ctx);
	return {
		id: "minimax-h3",
		displayName: ctx.i18n.t("provider.name"),
		capabilities: [
			{
				kind: "video",
				modes: ["image-to-video"],
				aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"],
				durationsSeconds: [5, 10, 15],
			},
		],
		async createJob(request, context) {
			const images = request.references.filter((reference) => reference.kind === "image");
			if (images.length !== 1) {
				return {
					id: crypto.randomUUID(),
					status: "failed",
					error: { code: "invalid-request", message: "MiniMax H3 requires exactly one image", retryable: false },
				};
			}
			try {
				const [template, uploadedImage] = await Promise.all([
					client.loadTemplate(),
					client.uploadImage(images[0].id, context),
				]);
				const adapted = adaptMinimaxWorkflow(
					template,
					request,
					uploadedImage,
					Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
				);
				const id = await client.submit(adapted.prompt);
				outputNodes.set(id, adapted.outputNodeId);
				return { id, status: "queued" };
			} catch (error) {
				return providerFailure(crypto.randomUUID(), error instanceof Error ? error.message : String(error));
			}
		},
		async getJob(jobId) {
			try {
				const entry = await client.history(jobId);
				if (entry?.status?.status_str === "error") {
					return providerFailure(jobId, "ComfyUI workflow execution failed");
				}
				if (entry?.status?.status_str === "success") {
					const nodeId = outputNodes.get(jobId);
					const file = outputFile(entry, nodeId);
					if (!file) return providerFailure(jobId, "ComfyUI completed without a video output");
					outputNodes.delete(jobId);
					return {
						id: jobId,
						status: "succeeded",
						artifacts: [{ kind: "video", mimeType: "video/mp4", source: { type: "remote-url", url: client.viewUrl(file) } }],
					};
				}
				const state = await client.queueState(jobId);
				return { id: jobId, status: state === "running" ? "running" : "queued" };
			} catch (error) {
				return providerFailure(jobId, error instanceof Error ? error.message : String(error));
			}
		},
		async cancelJob(jobId) {
			try {
				await client.cancel(jobId);
				outputNodes.delete(jobId);
				return { id: jobId, status: "cancelled" };
			} catch (error) {
				return providerFailure(jobId, error instanceof Error ? error.message : String(error));
			}
		},
	};
}
