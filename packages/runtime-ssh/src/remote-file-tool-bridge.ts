import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, posix } from "node:path";
import type { RuntimeToolDefinition, RuntimeToolResult } from "@vetta/runtime-core/kernel";
import type { CodingToolRegistration } from "@vetta/runtime-tools";
import type { SshConnection } from "@vetta/ssh-transport";

/**
 * 把「吃一个文件、吐一个文件」的本机工具桥接到远端文件上。
 *
 * PDF 提取、图片 OCR、页面渲染、文档转 PDF 都依赖本机的引擎（Desktop 自带的 OCR、pdftoppm、
 * 办公套件），搬不到远端去。但它们的形状完全一致：`input` 指向源文件，产物写到 `output`
 * （缺省落在源文件旁边）。于是远程会话里可以这样做：把远端的 `input` 取回本机临时目录，让
 * 本机工具原样处理，再把产物传回远端对应的位置——模型看到的参数与结果同本地项目一致，
 * 路径指的始终是远端。
 *
 * 取舍：输入整份过一次网络；HTML 这类靠相对路径引用旁边资源的输入，旁边的文件不会被带上。
 */
export interface RemoteFileToolBridgeOptions {
	readonly connection: SshConnection;
	/** 远端工作目录的绝对路径，相对的 `input` / `output` 以它为基准。 */
	readonly remoteCwd: string;
	/** 以一个本机目录为 cwd 创建本机工具。每次调用都会得到一个全新的临时目录。 */
	readonly createLocalRegistrations: (localCwd: string) => readonly CodingToolRegistration[];
}

interface FileToolInput {
	readonly input?: unknown;
	readonly output?: unknown;
	readonly [key: string]: unknown;
}

export function createRemoteFileToolRegistrations(
	options: RemoteFileToolBridgeOptions,
): readonly CodingToolRegistration[] {
	// 只为拿到名字、描述与 schema；真正执行时每次调用各建一份，绑定到那次的临时目录。
	return options.createLocalRegistrations(tmpdir()).map((template) => ({
		...template,
		tool: bridgeTool(template.tool, options),
	}));
}

function bridgeTool(template: RuntimeToolDefinition, options: RemoteFileToolBridgeOptions): RuntimeToolDefinition {
	const { connection, remoteCwd } = options;
	return {
		...template,
		async execute(request) {
			const input = request.input as FileToolInput;
			if (typeof input.input !== "string" || input.input.trim().length === 0) {
				throw new Error("input is required");
			}
			const remoteInput = await resolveRemotePath(connection, remoteCwd, input.input);
			const remoteOutput =
				typeof input.output === "string" && input.output.trim().length > 0
					? await resolveRemotePath(connection, remoteCwd, input.output)
					: undefined;

			const workDir = await mkdtemp(join(tmpdir(), "vetta-remote-tool-"));
			try {
				// 输入与产物分开放：产物目录里出现的每个文件都是要传回去的，不必猜哪个是新的。
				const inputDir = join(workDir, "in");
				const outputDir = join(workDir, "out");
				await mkdir(inputDir);
				await mkdir(outputDir);
				const localInput = join(inputDir, posix.basename(remoteInput));
				await writeFile(localInput, await connection.readFile(remoteInput, request.signal));

				// 没指定 output 时不替工具拿主意：它会按自己的规则把产物放在输入旁边（例如
				// `<input>.ocr.json`），事后把输入目录里新出现的文件原名传回远端输入所在的目录，
				// 远端的落点就与本地项目一致。
				const tool = options
					.createLocalRegistrations(inputDir)
					.find((item) => item.tool.name === template.name)?.tool;
				if (!tool) throw new Error(`Local tool is unavailable: ${template.name}`);
				const localOutput = remoteOutput ? join(outputDir, posix.basename(remoteOutput)) : undefined;
				const result = await tool.execute({
					...request,
					input: { ...input, input: localInput, ...(localOutput ? { output: localOutput } : {}) },
				} as never);

				const uploaded = await uploadProducts({
					connection,
					signal: request.signal,
					// 指定了 output：产物目录里那一个文件 → 远端指定的位置。
					// 没指定：工具写在输入旁边的新文件 → 远端输入所在目录，同名。
					sources: localOutput
						? [{ local: localOutput, remote: remoteOutput as string }]
						: (await listProducts(inputDir, basename(localInput))).map((name) => ({
								local: join(inputDir, name),
								remote: posix.join(posix.dirname(remoteInput), name),
							})),
				});
				return rewritePaths(result, [
					...uploaded.map((item) => [item.local, item.remote] as const),
					[localInput, remoteInput] as const,
					[inputDir, posix.dirname(remoteInput)] as const,
				]);
			} finally {
				await rm(workDir, { recursive: true, force: true });
			}
		},
	};
}

async function resolveRemotePath(connection: SshConnection, remoteCwd: string, path: string): Promise<string> {
	const expanded = await connection.expandRemotePath(path.trim());
	return posix.isAbsolute(expanded) ? posix.normalize(expanded) : posix.resolve(remoteCwd, expanded);
}

async function listProducts(directory: string, inputName: string): Promise<string[]> {
	return (await readdir(directory)).filter((name) => name !== inputName);
}

async function uploadProducts(options: {
	readonly connection: SshConnection;
	readonly signal: AbortSignal;
	readonly sources: readonly { local: string; remote: string }[];
}): Promise<{ local: string; remote: string }[]> {
	const uploaded: { local: string; remote: string }[] = [];
	for (const source of options.sources) {
		let content: Buffer;
		try {
			content = await readFile(source.local);
		} catch {
			continue; // 工具没产出这个文件（例如只返回了文本），没有可传的。
		}
		await options.connection.makeDirectory(posix.dirname(source.remote), options.signal);
		await options.connection.writeFile(source.remote, content, options.signal);
		uploaded.push(source);
	}
	return uploaded;
}

/** 结果文本里的本机临时路径换回远端路径：模型接下来要拿它去读的是远端那一份。 */
function rewritePaths(
	result: RuntimeToolResult,
	replacements: readonly (readonly [string, string])[],
): RuntimeToolResult {
	// 长的先换，免得目录前缀先被换掉、文件路径再也匹配不上。
	const ordered = [...replacements].sort((a, b) => b[0].length - a[0].length);
	return {
		...result,
		content: result.content.map((item) => {
			if (item.type !== "text") return item;
			let text = item.text;
			for (const [local, remote] of ordered) text = text.split(local).join(remote);
			return { ...item, text };
		}),
	};
}
