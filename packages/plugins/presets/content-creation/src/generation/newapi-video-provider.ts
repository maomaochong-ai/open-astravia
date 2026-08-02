import type { PluginNetworkApi, PluginSettingsApi } from "@vetta-org/plugin-sdk";
import { delay, dimensionsFor, downloadGeneratedContent, readStringSetting, requireStringSetting } from "./adapter-utils";
import type {
	ContentGenerationRequest,
	ContentModelDescriptor,
	ContentProviderAdapter,
	GeneratedContent,
} from "./types";

interface NewApiVideoProviderOptions {
	id: string;
	baseUrlSetting: string;
	apiKeySetting: string;
	modelSetting: string;
	pollIntervalMs?: number;
	maxPollAttempts?: number;
}

interface NewApiVideoTask {
	id?: string;
	task_id?: string;
	status?: string;
	url?: string;
	video_url?: string;
	output?: { url?: string };
	error?: { message?: string } | string;
}

export class NewApiVideoProvider implements ContentProviderAdapter {
	readonly id: string;

	constructor(
		private readonly network: PluginNetworkApi,
		private readonly settings: PluginSettingsApi,
		private readonly options: NewApiVideoProviderOptions,
	) {
		this.id = options.id;
	}

	listModels(): readonly ContentModelDescriptor[] {
		const modelId = readStringSetting(this.settings, this.options.modelSetting);
		return modelId
			? [
					{
						providerId: this.id,
						modelId,
						displayName: modelId,
						capabilities: ["text-to-video"],
						aspectRatios: ["16:9", "9:16"],
						resolutions: ["480p", "720p", "1080p"],
					},
				]
			: [];
	}

	async generate(request: ContentGenerationRequest): Promise<GeneratedContent> {
		const baseUrl = requireStringSetting(this.settings, this.options.baseUrlSetting, this.id).replace(/\/$/, "");
		const apiKey = requireStringSetting(this.settings, this.options.apiKeySetting, this.id);
		const response = await this.network.request<NewApiVideoTask>({
			url: `${baseUrl}/video/generations`,
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}` },
			body: {
				type: "json",
				value: {
					model: request.modelId,
					prompt: request.prompt,
					aspect_ratio: request.aspectRatio ?? "16:9",
					duration: request.duration ?? 5,
					resolution: request.resolution ?? "720p",
				},
			},
			responseType: "json",
			timeoutMs: 30_000,
		});
		if (!response.ok) throw new Error(`NewAPI video provider returned HTTP ${response.status}`);
		const task = await this.resolveTask(response.body, baseUrl, apiKey);
		const outputUrl = task.video_url ?? task.url ?? task.output?.url;
		if (!outputUrl) throw new Error(taskError(task) || "NewAPI video response is missing output URL");
		return downloadGeneratedContent(
			this.network,
			outputUrl,
			{
				kind: "video",
				mimeType: "video/mp4",
				...dimensionsFor(request.aspectRatio, request.resolution ?? "720p"),
				duration: request.duration ?? 5,
			},
			outputUrl.startsWith(`${baseUrl}/`) ? { Authorization: `Bearer ${apiKey}` } : undefined,
		);
	}

	private async resolveTask(task: NewApiVideoTask, baseUrl: string, apiKey: string): Promise<NewApiVideoTask> {
		if (task.video_url || task.url || task.output?.url) return task;
		const taskId = task.task_id ?? task.id;
		if (!taskId) return task;
		for (let attempt = 0; attempt < (this.options.maxPollAttempts ?? 60); attempt += 1) {
			await delay(this.options.pollIntervalMs ?? 5_000);
			const response = await this.network.request<NewApiVideoTask>({
				url: `${baseUrl}/video/generations/${encodeURIComponent(taskId)}`,
				headers: { Authorization: `Bearer ${apiKey}` },
				responseType: "json",
				timeoutMs: 15_000,
			});
			if (!response.ok) continue;
			if (response.body.video_url || response.body.url || response.body.output?.url) return response.body;
			if (response.body.status === "failed" || response.body.status === "canceled") {
				throw new Error(taskError(response.body) || `NewAPI video task ${response.body.status}`);
			}
		}
		throw new Error("NewAPI video generation timed out");
	}
}

function taskError(task: NewApiVideoTask): string | undefined {
	return typeof task.error === "string" ? task.error : task.error?.message;
}
