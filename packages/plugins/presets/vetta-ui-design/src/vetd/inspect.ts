/**
 * 一份设计当前的全部机检结果，给工具返回和轮次兜底共用。
 *
 * 拆出来是因为两条链路要的是同一份东西：vetd_status / vetd_screenshot 把它交给
 * agent 主动读，build-error-report 在轮次结束时挑出其中的硬阻塞主动退回。放在
 * tools.ts 里私有会逼另一边重写一遍收集逻辑。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { checkSources, type SourceFile, type SourceIssue } from "./check-sources";
import { checkSyntax } from "./check-syntax";

/** 送进机检的全部设计源码：画框与共享组件。 */
export async function collectSources(fs: PluginContext["fs"], dirPath: string): Promise<SourceFile[]> {
	const files: SourceFile[] = [];
	for (const dir of ["frames", "components"]) {
		let entries: Awaited<ReturnType<PluginContext["fs"]["readDir"]>>;
		try {
			entries = await fs.readDir(`${dirPath}/${dir}`);
		} catch {
			continue; // components/ 可以不存在
		}
		for (const entry of entries) {
			if (entry.isDirectory || !entry.name.endsWith(".tsx")) continue;
			try {
				const { content } = await fs.readFile(entry.path);
				files.push({ path: `${dir}/${entry.name}`, content });
			} catch {
				// 读不到就跳过：这条链路只做检查，不该因为一个文件失败而整体报错
			}
		}
	}
	return files;
}

/**
 * 语法错在前，风格违规在后。
 *
 * 顺序不是排版问题——语法错意味着那一帧压根没在渲染，排在一条 hex 颜色后面会被
 * 当成同一量级的建议。两条链路并发跑：正则那条只读文件，esbuild 那条起一个 node。
 */
export async function inspectIssues(
	ctx: PluginContext,
	fs: PluginContext["fs"],
	dirPath: string,
): Promise<SourceIssue[]> {
	const [ruleIssues, syntaxIssues] = await Promise.all([
		collectSources(fs, dirPath).then(checkSources),
		checkSyntax(ctx, dirPath),
	]);
	return [...syntaxIssues, ...ruleIssues];
}
