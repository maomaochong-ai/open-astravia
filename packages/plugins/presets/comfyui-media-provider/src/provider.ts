import type {
	PluginContext,
	PluginMediaGenerationModeCapability,
	PluginMediaKind,
	PluginMediaProviderInput,
	PluginMediaProviderJob,
	PluginMediaProviderRegistration,
} from "@vetta-org/plugin-sdk";
import { ComfyUiClient, outputFile } from "./comfyui-client";
import { adaptMinimaxWorkflow } from "./workflow-adapter";

const outputNodes = new Map<string, string>();

type VideoProviderInput = PluginMediaProviderInput & { kind: Exclude<PluginMediaKind, "document"> };

const FRAME_MODE: PluginMediaGenerationModeCapability = {
	mode: "image-to-video",
	inputs: [
		{ role: "firstFrame", kinds: ["image"], minItems: 0, maxItems: 1 },
		{ role: "lastFrame", kinds: ["image"], minItems: 0, maxItems: 1 },
	],
	minTotalItems: 1,
	maxTotalItems: 2,
	aspectRatioPolicy: "input-derived",
	audioGeneration: "always",
};

const REFERENCE_MODE: PluginMediaGenerationModeCapability = {
	mode: "reference-to-video",
	inputs: [
		{ role: "referenceImages", kinds: ["image"], minItems: 0, maxItems: 9 },
		{ role: "referenceVideos", kinds: ["video"], minItems: 0, maxItems: 3 },
		{ role: "referenceAudios", kinds: ["audio"], minItems: 0, maxItems: 3 },
	],
	minTotalItems: 1,
	maxTotalItems: 12,
	aspectRatioPolicy: "configurable",
	audioGeneration: "always",
};

function providerFailure(id: string, message: string): PluginMediaProviderJob {
	return {
		id,
		status: "failed",
		error: { code: "provider-failed", message, retryable: true },
	};
}

function invalidRequest(message: string): PluginMediaProviderJob {
	return {
		id: crypto.randomUUID(),
		status: "failed",
		error: { code: "invalid-request", message, retryable: false },
	};
}

function normalizeInputRoles(
	inputs: readonly VideoProviderInput[],
	mode: PluginMediaGenerationModeCapability,
): VideoProviderInput[] {
	let rolelessImageIndex = 0;
	return inputs.map((input) => {
		if (input.role) return input;
		if (mode.mode === "image-to-video" && input.kind === "image") {
			const role = rolelessImageIndex === 0 ? "firstFrame" : "lastFrame";
			rolelessImageIndex += 1;
			return { ...input, role };
		}
		const role = input.kind === "image" ? "referenceImages" : input.kind === "video" ? "referenceVideos" : "referenceAudios";
		return { ...input, role };
	});
}

function validateInputs(inputs: readonly VideoProviderInput[], mode: PluginMediaGenerationModeCapability): string | undefined {
	if ((mode.minTotalItems ?? 0) > inputs.length || (mode.maxTotalItems ?? Number.POSITIVE_INFINITY) < inputs.length) {
		return `${mode.mode} requires ${mode.minTotalItems ?? 0}–${mode.maxTotalItems ?? "unlimited"} inputs`;
	}
	for (const input of inputs) {
		const slot = mode.inputs.find((candidate) => candidate.role === input.role);
		if (!slot || !slot.kinds.includes(input.kind as PluginMediaKind)) return `Unsupported ${input.kind} input role: ${input.role ?? "none"}`;
	}
	for (const slot of mode.inputs) {
		const count = inputs.filter((input) => input.role === slot.role).length;
		if (count < slot.minItems || count > slot.maxItems) return `${slot.role} accepts ${slot.minItems}–${slot.maxItems} inputs`;
	}
	return undefined;
}

function isVideoProviderInput(input: PluginMediaProviderInput): input is VideoProviderInput {
	return input.kind === "image" || input.kind === "video" || input.kind === "audio";
}

export function createComfyUiProvider(ctx: PluginContext): PluginMediaProviderRegistration {
	const client = new ComfyUiClient(ctx);
	const referenceEnabled = Boolean(ctx.settings.get<string>("referenceTemplatePromptId")?.trim());
	const modeCapabilities = referenceEnabled ? [FRAME_MODE, REFERENCE_MODE] : [FRAME_MODE];
	return {
		id: "minimax-h3",
		displayName: ctx.i18n.t("provider.name"),
		capabilities: [
			{
				operation: "generate",
				kind: "video",
				modes: modeCapabilities.map(({ mode }) => mode),
				aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"],
				// MiniMax H3 accepts continuous duration; expose every second from 4–15.
				durationsSeconds: Array.from({ length: 12 }, (_, second) => second + 4),
				modeCapabilities,
			},
		],
		async submit(request, context) {
			if (request.operation !== "generate") {
				return {
					id: crypto.randomUUID(),
					status: "failed",
					error: { code: "operation-unsupported", message: "MiniMax H3 only generates video", retryable: false },
				};
			}
			const mode = modeCapabilities.find((candidate) => candidate.mode === request.mode);
			if (!mode) return invalidRequest(`MiniMax H3 mode is not configured: ${request.mode}`);
			if (!request.inputs.every(isVideoProviderInput)) return invalidRequest("MiniMax H3 does not accept document inputs");
			const inputs = normalizeInputRoles(request.inputs, mode);
			const validationError = validateInputs(inputs, mode);
			if (validationError) return invalidRequest(validationError);
			try {
				const [template, uploadedPaths] = await Promise.all([
					client.loadTemplate(request.mode),
					Promise.all(inputs.map((input) => client.uploadInput(input.id, context))),
				]);
				const adapted = adaptMinimaxWorkflow(
					template,
					request,
					inputs.map((input, index) => ({ ...input, path: uploadedPaths[index] })),
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
