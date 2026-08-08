import type { PluginContext, PluginMediaArtifact } from "@vetta-org/plugin-sdk";
import { createRemotionRenderDocument, REMOTION_DOCUMENT_MIME_TYPE } from "../render-document";

interface RenderRemotionInput {
	compositionId: string;
	inputProps?: Record<string, unknown>;
	outputName?: string;
	entryPoint?: string;
}

const SCOPE_USE = ["conversation", "project"] as const;
const PROVIDER_ID = "remotion-renderer:local";

function joinPath(root: string, relative: string): string {
	return `${root.replace(/[\\/]+$/, "")}/${relative.replace(/^[\\/]+/, "")}`;
}

function normalizeEntryPoint(value: string | undefined): string | null {
	const entryPoint = (value ?? "src/index.ts").trim().replaceAll("\\", "/");
	if (!entryPoint || entryPoint.startsWith("/") || /^[a-zA-Z]:/.test(entryPoint)) return null;
	if (entryPoint.split("/").some((segment) => segment === "..")) return null;
	return entryPoint;
}

function normalizeOutputName(value: string | undefined, compositionId: string): string | null {
	const base = (value?.trim() || compositionId.trim()).replace(/\.mp4$/i, "");
	if (!base || base === "." || base === ".." || base.length > 128 || /[\\/\0]/.test(base)) return null;
	return `${base}.mp4`;
}

async function ensureDirectory(ctx: PluginContext, path: string): Promise<void> {
	if (await ctx.fs.stat(path)) return;
	await ctx.fs.createDirectory(path);
}

async function cleanup(ctx: PluginContext, paths: readonly string[]): Promise<void> {
	await Promise.all(paths.map((path) => ctx.fs.delete(path).catch(() => undefined)));
}

async function hasFile(ctx: PluginContext, path: string): Promise<boolean> {
	return (await ctx.fs.stat(path)) !== null;
}

export function registerRenderTool(ctx: PluginContext): void {
	ctx.agent.registerTool<RenderRemotionInput>({
		id: "render-remotion-video",
		name: "render_remotion_video",
		label: "%tool.render%",
		description:
			"Render a Remotion composition from the current conversation workspace to an MP4 file. The workspace itself is the Remotion project. Invoke the remotion-video skill before creating or changing the project, ensure dependencies are installed, then call this tool after the composition code is complete.",
		parameters: {
			type: "object",
			properties: {
				compositionId: {
					type: "string",
					description: "Exact Composition id registered in the Remotion root.",
				},
				inputProps: {
					type: "object",
					description: "JSON input props passed to the Composition.",
					additionalProperties: true,
				},
				outputName: {
					type: "string",
					description: "MP4 file name inside out/. Defaults to the Composition id.",
				},
				entryPoint: {
					type: "string",
					description: "Project-relative Remotion entry point. Defaults to src/index.ts.",
				},
			},
			required: ["compositionId"],
			additionalProperties: false,
		},
		timeoutMs: 30 * 60_000,
		scope_use: SCOPE_USE,
		handler: async ({ host, session, trigger }) => {
			const compositionId = trigger.input.compositionId.trim();
			const entryPoint = normalizeEntryPoint(trigger.input.entryPoint);
			const outputName = normalizeOutputName(trigger.input.outputName, compositionId);
			if (!compositionId || !entryPoint || !outputName) {
				return { ok: false, retryable: true, error: "Invalid composition id, entry point, or output name." };
			}
			const packagePath = joinPath(session.cwd, "package.json");
			const entryPath = joinPath(session.cwd, entryPoint);
			const cliPackagePath = joinPath(session.cwd, "node_modules/@remotion/cli/package.json");
			if (!(await hasFile(ctx, packagePath)) || !(await hasFile(ctx, entryPath))) {
				return {
					ok: false,
					retryable: true,
					error:
						"The current conversation directory is not a complete Remotion project. Invoke the remotion-video skill and create package.json plus the entry point first.",
				};
			}
			if (!(await hasFile(ctx, cliPackagePath))) {
				return {
					ok: false,
					retryable: true,
					error: "Remotion dependencies are not installed in this project. Run `npm install` in the current workspace, then retry.",
				};
			}

			const jobId = crypto.randomUUID();
			const jobsDir = joinPath(session.cwd, ".vetta/remotion/jobs");
			const outDir = joinPath(session.cwd, "out");
			await ensureDirectory(ctx, joinPath(session.cwd, ".vetta"));
			await ensureDirectory(ctx, joinPath(session.cwd, ".vetta/remotion"));
			await ensureDirectory(ctx, jobsDir);
			await ensureDirectory(ctx, outDir);
			const documentPath = joinPath(jobsDir, `${jobId}.json`);
			const temporaryOutputPath = joinPath(jobsDir, `${jobId}.mp4`);
			const finalOutputPath = joinPath(outDir, outputName);
			const document = createRemotionRenderDocument({
				projectRoot: session.cwd,
				entryPoint,
				compositionId,
				inputProps: trigger.input.inputProps ?? {},
				outputPath: temporaryOutputPath,
			});
			await host.fs.writeFile(documentPath, JSON.stringify(document, null, 2));

			let artifact: PluginMediaArtifact | undefined;
			try {
				const providers = await ctx.media.listProviders();
				const provider =
					providers.find((candidate) => candidate.id === PROVIDER_ID) ??
					providers.find((candidate) =>
						candidate.capabilities.some(
							(capability) =>
								capability.operation === "compose" &&
								capability.documentMimeTypes.includes(REMOTION_DOCUMENT_MIME_TYPE) &&
								capability.outputMimeTypes.includes("video/mp4"),
						),
					);
				if (!provider) throw new Error("The local Remotion media provider is unavailable");
				const submitted = await ctx.media.submit({
					operation: "compose",
					providerId: provider.id,
					inputs: [
						{
							id: jobId,
							kind: "document",
							mimeType: REMOTION_DOCUMENT_MIME_TYPE,
							source: { type: "workspace-file", path: documentPath },
						},
					],
					output: { kind: "video", mimeType: "video/mp4", videoCodec: "h264" },
				});
				const job = await ctx.jobs.wait(submitted, { pollIntervalMs: 750 });
				if (job.status === "failed") {
					return { ok: false, retryable: job.error?.retryable ?? true, error: job.error?.message ?? "Rendering failed" };
				}
				if (job.status === "cancelled") return { ok: false, retryable: true, error: "Rendering was cancelled." };
				artifact = job.artifacts[0];
				if (!artifact || artifact.kind !== "video") throw new Error("Remotion returned no video artifact");
				const saved = await ctx.artifacts.persist(artifact, {
					type: "workspace-file",
					path: finalOutputPath,
				});
				if (saved.type !== "workspace-file") throw new Error("The rendered video was not saved to the workspace");
				await ctx.fileExplorer.refresh(outDir);
				await ctx.fileExplorer.reveal(finalOutputPath, { select: true });
				return {
					ok: true,
					compositionId,
					outputPath: saved.path,
					mimeType: saved.mimeType,
					sizeBytes: saved.sizeBytes,
					summary: `Rendered Remotion composition "${compositionId}" to ${saved.path}`,
				};
			} finally {
				if (artifact) await ctx.artifacts.release(artifact).catch(() => undefined);
				await cleanup(ctx, [documentPath, temporaryOutputPath]);
			}
		},
	});
}

