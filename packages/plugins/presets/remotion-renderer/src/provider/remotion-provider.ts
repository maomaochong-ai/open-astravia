import type {
	PluginContext,
	PluginMediaProviderJob,
	PluginMediaProviderRegistration,
	PluginNetworkResponse,
} from "@vetta-org/plugin-sdk";
import { startRemotionServer } from "../engine/engine-manager";
import { REMOTION_DOCUMENT_MIME_TYPE } from "../render-document";

interface SidecarJob {
	id?: unknown;
	status?: unknown;
	progress?: unknown;
	artifact?: { path?: unknown };
	error?: unknown;
}

function failure(id: string, message: string, retryable = true): PluginMediaProviderJob {
	return {
		id,
		status: "failed",
		error: { code: "provider-failed", message, retryable },
	};
}

function responseError(response: PluginNetworkResponse<unknown>): string {
	const body = response.body;
	if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
		return body.error;
	}
	return `HTTP ${response.status} ${response.statusText}`.trim();
}

function mapJob(value: SidecarJob, fallbackId: string): PluginMediaProviderJob {
	const id = typeof value.id === "string" && value.id ? value.id : fallbackId;
	if (
		value.status !== "queued" &&
		value.status !== "running" &&
		value.status !== "succeeded" &&
		value.status !== "failed" &&
		value.status !== "cancelled"
	) {
		return failure(id, "Remotion engine returned an invalid job status");
	}
	const progress = typeof value.progress === "number" ? Math.min(1, Math.max(0, value.progress)) : undefined;
	if (value.status === "failed") {
		return failure(id, typeof value.error === "string" ? value.error : "Remotion rendering failed");
	}
	if (value.status === "succeeded") {
		const path = value.artifact?.path;
		if (typeof path !== "string" || !path) return failure(id, "Remotion completed without an output path");
		return {
			id,
			status: "succeeded",
			progress: 1,
			artifacts: [
				{
					kind: "video",
					mimeType: "video/mp4",
					name: path.split(/[\\/]/).pop(),
					source: { type: "workspace-file", path },
				},
			],
		};
	}
	return { id, status: value.status, ...(progress === undefined ? {} : { progress }) };
}

async function requestJob(
	ctx: PluginContext,
	jobId: string,
	method: "GET" | "DELETE",
): Promise<PluginMediaProviderJob> {
	try {
		const server = await startRemotionServer(ctx);
		const response = await ctx.network.request<SidecarJob>({
			url: `http://127.0.0.1:${server.port}/jobs/${encodeURIComponent(jobId)}`,
			method,
			responseType: "json",
			timeoutMs: 30_000,
		});
		if (!response.ok) return failure(jobId, responseError(response));
		return mapJob(response.body, jobId);
	} catch (error) {
		return failure(jobId, error instanceof Error ? error.message : String(error));
	}
}

export function createRemotionProvider(ctx: PluginContext): PluginMediaProviderRegistration {
	return {
		id: "local",
		displayName: ctx.i18n.t("provider.name"),
		capabilities: [
			{
				operation: "compose",
				documentMimeTypes: [REMOTION_DOCUMENT_MIME_TYPE],
				outputMimeTypes: ["video/mp4"],
			},
		],
		async submit(request, context) {
			const requestId = crypto.randomUUID();
			if (request.operation !== "compose") {
				return {
					id: requestId,
					status: "failed",
					error: {
						code: "operation-unsupported",
						message: "Remotion only supports media composition",
						retryable: false,
					},
				};
			}
			const document = request.inputs.find(
				(input) => input.kind === "document" && input.mimeType === REMOTION_DOCUMENT_MIME_TYPE,
			);
			if (!document || request.inputs.length !== 1 || request.output.mimeType !== "video/mp4") {
				return {
					id: requestId,
					status: "failed",
					error: {
						code: "invalid-request",
						message: "Remotion requires one typed project document and MP4 output",
						retryable: false,
					},
				};
			}
			try {
				const server = await startRemotionServer(ctx);
				const response = await context.uploadInput<SidecarJob>(document.id, {
					url: `http://127.0.0.1:${server.port}/jobs`,
					fieldName: "document",
					fileName: "remotion-render.json",
					timeoutMs: 60_000,
				});
				if (!response.ok) return failure(requestId, responseError(response));
				return mapJob(response.body, requestId);
			} catch (error) {
				return failure(requestId, error instanceof Error ? error.message : String(error));
			}
		},
		getJob(jobId) {
			return requestJob(ctx, jobId, "GET");
		},
		cancelJob(jobId) {
			return requestJob(ctx, jobId, "DELETE");
		},
	};
}

