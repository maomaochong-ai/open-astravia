import type {
	PluginContext,
	PluginMediaGenerationMode,
	PluginMediaProviderHandlerContext,
	PluginNetworkRequest,
} from "@vetta-org/plugin-sdk";
import { isCompatibleMinimaxPrompt, type ComfyPrompt } from "./workflow-adapter";

interface HistoryEntry {
	prompt?: unknown[];
	outputs?: Record<string, { images?: ComfyOutputFile[] }>;
	status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
}

export interface ComfyOutputFile {
	filename: string;
	subfolder?: string;
	type?: string;
}

interface QueueResponse {
	queue_running?: unknown[][];
	queue_pending?: unknown[][];
}

function normalizeBaseUrl(value: unknown): string {
	const url = new URL(typeof value === "string" && value.trim() ? value.trim() : "http://127.0.0.1:8188");
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("ComfyUI URL must use HTTP or HTTPS");
	return url.toString().replace(/\/$/, "");
}

function errorDetail(body: unknown): string {
	if (typeof body === "string") return body;
	try {
		return JSON.stringify(body);
	} catch {
		return String(body);
	}
}

export class ComfyUiClient {
	constructor(private readonly ctx: PluginContext) {}

	get baseUrl(): string {
		return normalizeBaseUrl(this.ctx.settings.get("baseUrl"));
	}

	private async request<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
		const request: PluginNetworkRequest = {
			url: `${this.baseUrl}${path}`,
			method: init?.method ?? "GET",
			responseType: "json",
			timeoutMs: 120_000,
			...(init?.body === undefined ? {} : { body: { type: "json", value: init.body } }),
		};
		const response = await this.ctx.network.request<T>(request);
		if (!response.ok) {
			throw new Error(`ComfyUI ${path} failed: HTTP ${response.status} ${errorDetail(response.body)}`);
		}
		return response.body;
	}

	async uploadInput(inputId: string, context: PluginMediaProviderHandlerContext): Promise<string> {
		const response = await context.uploadInput<{ name?: string; subfolder?: string }>(inputId, {
			url: `${this.baseUrl}/upload/image`,
			fieldName: "image",
			fields: { overwrite: "true", type: "input" },
		});
		if (!response.ok || !response.body?.name) {
			throw new Error(`ComfyUI image upload failed: HTTP ${response.status} ${errorDetail(response.body)}`);
		}
		return response.body.subfolder ? `${response.body.subfolder}/${response.body.name}` : response.body.name;
	}

	async loadTemplate(mode: PluginMediaGenerationMode): Promise<ComfyPrompt> {
		const settingKey = mode === "reference-to-video" ? "referenceTemplatePromptId" : "templatePromptId";
		const configuredId = this.ctx.settings.get<string>(settingKey)?.trim();
		const history = await this.request<Record<string, HistoryEntry>>(
			configuredId ? `/history/${encodeURIComponent(configuredId)}` : "/history?max_items=20",
		);
		for (const entry of Object.values(history).reverse()) {
			const prompt = entry.prompt?.[2];
			if (entry.status?.status_str === "success" && isCompatibleMinimaxPrompt(prompt, mode)) return prompt;
		}
		throw new Error(
			configuredId
				? `Configured ComfyUI template job is unavailable or incompatible: ${configuredId}`
				: `No successful compatible MiniMax H3 ${mode} API Prompt was found in ComfyUI history`,
		);
	}

	async submit(prompt: ComfyPrompt): Promise<string> {
		const result = await this.request<{ prompt_id?: string }>("/prompt", {
			method: "POST",
			body: { prompt, client_id: crypto.randomUUID() },
		});
		if (!result.prompt_id) throw new Error("ComfyUI did not return a prompt id");
		return result.prompt_id;
	}

	async history(jobId: string): Promise<HistoryEntry | undefined> {
		return (await this.request<Record<string, HistoryEntry>>(`/history/${encodeURIComponent(jobId)}`))[jobId];
	}

	async queueState(jobId: string): Promise<"running" | "queued" | "missing"> {
		const queue = await this.request<QueueResponse>("/queue");
		if (queue.queue_running?.some((entry) => entry[1] === jobId)) return "running";
		if (queue.queue_pending?.some((entry) => entry[1] === jobId)) return "queued";
		return "missing";
	}

	async cancel(jobId: string): Promise<void> {
		const state = await this.queueState(jobId);
		if (state === "running") await this.request("/interrupt", { method: "POST", body: {} });
		if (state === "queued") await this.request("/queue", { method: "POST", body: { delete: [jobId] } });
	}

	viewUrl(file: ComfyOutputFile): string {
		const query = new URLSearchParams({
			filename: file.filename,
			subfolder: file.subfolder ?? "",
			type: file.type ?? "output",
		});
		return `${this.baseUrl}/view?${query.toString()}`;
	}
}

export function outputFile(entry: HistoryEntry, outputNodeId?: string): ComfyOutputFile | undefined {
	if (outputNodeId) return entry.outputs?.[outputNodeId]?.images?.[0];
	return Object.values(entry.outputs ?? {}).find((output) => output.images?.length)?.images?.[0];
}
