import type { ContentNode, ContentProjectDocument } from "../project/types";
import type { ContentCreationWorkspace } from "../project/workspace";
import type { ContentProviderRegistry } from "./provider-registry";
import type { ContentArtifactStore, ContentGenerationCapability, ContentModelDescriptor } from "./types";

function requireNode(project: ContentProjectDocument, nodeId: string): ContentNode {
	const node = project.graph.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) throw new Error(`content node not found: ${nodeId}`);
	return node;
}

function resolvePrompt(project: ContentProjectDocument, node: ContentNode): string {
	const direct = node.data.prompt?.trim();
	if (direct) return direct;
	const promptEdge = project.graph.edges.find((edge) => edge.target === node.id && edge.targetHandle === "prompt");
	const source = promptEdge ? project.graph.nodes.find((candidate) => candidate.id === promptEdge.source) : undefined;
	const connected = source?.data.prompt?.trim();
	if (!connected) throw new Error("content generation requires a prompt");
	return connected;
}

export class ContentGenerationService {
	constructor(
		private readonly workspace: ContentCreationWorkspace,
		private readonly providers: ContentProviderRegistry,
		private readonly artifacts: ContentArtifactStore,
	) {}

	listModels(capability?: ContentGenerationCapability): ContentModelDescriptor[] {
		return this.providers.listModels(capability);
	}

	async runNode(cwd: string | null, nodeId: string): Promise<ContentProjectDocument> {
		const project = await this.workspace.load(cwd);
		const node = requireNode(project, nodeId);
		const capability = capabilityForNode(node);
		if (node.status === "running" || node.status === "queued") throw new Error(`node is already running: ${nodeId}`);
		const models = this.listModels(capability);
		const providerId = node.data.providerId ?? models[0]?.providerId;
		const modelId = node.data.modelId ?? models.find((model) => model.providerId === providerId)?.modelId;
		if (!providerId || !modelId) throw new Error("no compatible content model is configured");
		const prompt = resolvePrompt(project, node);
		const jobId = crypto.randomUUID();
		const assetId = crypto.randomUUID();

		await this.workspace.dispatch(cwd, [{ type: "job.start", job: { id: jobId, nodeId, providerId, modelId } }]);
		try {
			const generated = await this.providers.generate({
				capability,
				providerId,
				modelId,
				prompt,
				aspectRatio: node.data.aspectRatio,
				quality: node.data.quality,
				duration: node.data.duration,
				resolution: node.data.resolution,
			});
			const stored = await this.artifacts.put(assetId, generated);
			return await this.workspace.dispatch(cwd, [
				{
					type: "job.succeed",
					jobId,
					asset: {
						id: assetId,
						kind: generated.kind,
						name: `${node.data.label?.trim() || `${generated.kind}-${assetId.slice(0, 8)}`}.${extensionForMimeType(generated.mimeType)}`,
						mimeType: stored.mimeType,
						url: stored.url,
						duration: generated.duration,
						width: generated.width,
						height: generated.height,
						createdAt: new Date().toISOString(),
					},
				},
			]);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await this.workspace.dispatch(cwd, [{ type: "job.fail", jobId, error: message }]);
			throw error;
		}
	}
}

function capabilityForNode(node: ContentNode): ContentGenerationCapability {
	if (node.kind === "image-generator") return "text-to-image";
	if (node.kind === "video-generator") return "text-to-video";
	throw new Error(`node is not executable: ${node.kind}`);
}

function extensionForMimeType(mimeType: string): string {
	if (mimeType === "image/jpeg") return "jpg";
	if (mimeType === "image/webp") return "webp";
	if (mimeType === "video/webm") return "webm";
	if (mimeType.startsWith("video/")) return "mp4";
	return "png";
}
