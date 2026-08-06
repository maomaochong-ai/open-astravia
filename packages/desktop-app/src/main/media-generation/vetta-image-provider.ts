import { randomUUID } from "node:crypto";
import type {
	MediaDimensions,
	MediaFailure,
	MediaProviderCreateJobInput,
	MediaProviderJob,
} from "@vetta/capability-sdk";
import { MEDIA_PROTOCOL_VERSION } from "@vetta/capability-sdk";
import {
	requestVettaGateway,
	type VettaGatewayRequest,
	type VettaGatewayResponse,
} from "../gateway/vetta-gateway-service.js";
import type { MediaProviderRegistration } from "./media-provider-registry.js";

interface GatewayImageResult {
	data: string;
	mime_type?: string;
	size?: string;
}

type GatewayRequest = <T>(request: VettaGatewayRequest, signal?: AbortSignal) => Promise<VettaGatewayResponse<T>>;

const DEFAULT_SIZE = "1024x1024";
const IMAGE_ERROR_CODES = {
	SERVICE_DISABLED: 40301,
	SUBSCRIPTION_INACTIVE: 40302,
	MODEL_NOT_IN_PLAN: 40303,
	QUOTA_EXHAUSTED: 42902,
	NOT_CONFIGURED: 50302,
} as const;

function dimensionsToSize(dimensions: MediaDimensions | undefined): string {
	return dimensions ? `${dimensions.width}x${dimensions.height}` : DEFAULT_SIZE;
}

function dimensionsFromSize(size: string | undefined): MediaDimensions | undefined {
	const match = size ? /^(\d+)x(\d+)$/.exec(size) : null;
	if (!match) return undefined;
	const width = Number(match[1]);
	const height = Number(match[2]);
	return width > 0 && height > 0 ? { width, height } : undefined;
}

function sniffMime(base64: string): string {
	const prefix = base64.slice(0, 24);
	if (prefix.startsWith("iVBORw0KGgo")) return "image/png";
	if (prefix.startsWith("/9j/")) return "image/jpeg";
	if (prefix.startsWith("UklGR")) return "image/webp";
	if (prefix.startsWith("R0lGOD")) return "image/gif";
	return "image/png";
}

function gatewayFailure(code: number, status: number, message: string): MediaFailure {
	if (code === IMAGE_ERROR_CODES.QUOTA_EXHAUSTED) return { code: "quota-exhausted", message, retryable: false };
	if (code === IMAGE_ERROR_CODES.MODEL_NOT_IN_PLAN || code === IMAGE_ERROR_CODES.SUBSCRIPTION_INACTIVE) {
		return { code: "not-entitled", message, retryable: false };
	}
	if (code === IMAGE_ERROR_CODES.NOT_CONFIGURED || code === IMAGE_ERROR_CODES.SERVICE_DISABLED) {
		return { code: "provider-unavailable", message, retryable: false };
	}
	if (status === 0 && /timed out/i.test(message)) return { code: "provider-timeout", message, retryable: true };
	return { code: "provider-failed", message, retryable: status === 0 || status >= 500 };
}

async function createImageJob(
	requestGateway: GatewayRequest,
	input: MediaProviderCreateJobInput,
	signal: AbortSignal,
): Promise<MediaProviderJob> {
	const source = input.mode === "image-to-image" ? input.references[0] : undefined;
	if (input.mode === "text-to-image" && input.references.length !== 0) {
		return {
			id: randomUUID(),
			status: "failed",
			error: { code: "invalid-request", message: "Text-to-image does not accept references", retryable: false },
		};
	}
	if (input.mode === "image-to-image" && (input.references.length !== 1 || source?.kind !== "image")) {
		return {
			id: randomUUID(),
			status: "failed",
			error: { code: "invalid-request", message: "Image editing requires exactly one image", retryable: false },
		};
	}
	const response = await requestGateway<GatewayImageResult>(
		{
			path: input.mode === "image-to-image" ? "images/edit" : "images/generate",
			method: "POST",
			body: {
				prompt: input.prompt,
				size: dimensionsToSize(input.dimensions),
				...(source ? { image: source.data, mime_type: source.mimeType } : {}),
			},
			timeoutMs: 300_000,
		},
		signal,
	);
	if (!response.ok || !response.data?.data) {
		return {
			id: randomUUID(),
			status: "failed",
			error: gatewayFailure(
				response.code,
				response.status,
				response.message || `Gateway returned HTTP ${response.status}`,
			),
		};
	}
	const dimensions = dimensionsFromSize(response.data.size);
	return {
		id: randomUUID(),
		status: "succeeded",
		progress: 1,
		artifacts: [
			{
				kind: "image",
				data: response.data.data,
				mimeType: response.data.mime_type || sniffMime(response.data.data),
				...dimensions,
			},
		],
	};
}

export function createVettaImageProvider(
	requestGateway: GatewayRequest = requestVettaGateway,
): MediaProviderRegistration {
	return {
		descriptor: {
			id: "desktop-app:vetta",
			ownerId: "desktop-app",
			protocolVersion: MEDIA_PROTOCOL_VERSION,
			capabilities: [
				{
					kind: "image",
					modes: ["text-to-image", "image-to-image"],
					aspectRatios: ["1:1", "2:3", "3:2"],
				},
			],
		},
		createJob: (input, context) => createImageJob(requestGateway, input, context.signal),
	};
}
