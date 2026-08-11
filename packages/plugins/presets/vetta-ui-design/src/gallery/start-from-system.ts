import { designMdWithFrontmatter } from "../design-systems/apply";
import type { DesignSystem } from "../design-systems/types";
import { getPluginCtx } from "../plugin-context";
import { createDesignProject } from "./gallery-actions";
import { DESIGN_SKILL_DRAFT } from "./open-project";

/**
 * 从一套设计体系开一份新设计（侧边栏「设计」页的风格库入口）。
 *
 * 只把体系**作为参考资料**落到项目的 `design-resources/<id>/`，不预先建设计文档：
 * 设计文档由 agent 按用户的第一句需求创建（`vetd_create`），名字和尺寸都该由需求
 * 决定。之前这里先 scaffold 一份并把体系应用上去，结果 agent 照旧另建一份，用户
 * 拿到两份设计文档，而且真正在用的那份没有体系。
 */

/** 参考资料在项目里的落点。放项目根而不是设计包内：它是资料，不是设计的一部分。 */
export const DESIGN_RESOURCES_DIR = "design-resources";

export interface StartedFromSystem {
	cwd: string;
	/** 参考资料目录（项目相对路径）。 */
	resourcesDir: string;
	/** 实际落盘成功的资源（相对资料目录）。 */
	written: string[];
}

/**
 * 进会话时预置的输入框草稿：只说用户的意图（用哪套风格），一句人话。
 *
 * 「先读 DESIGN.md、拷 theme.css、素材不抄代码」这套固定协议在 skill 的
 * design-resources 一节里（草稿开头的 `@skill:` badge 已把它带进上下文），
 * 文件清单在落盘时写成的 `INDEX.md` 里——两样都不该占用用户的输入框。
 * 与 buildRestylePrompt 同一取舍：草稿跟宿主 locale 走，不进 locales catalog。
 */
export function buildStyleStartDraft(system: DesignSystem, locale: string): string {
	return locale.toLowerCase().startsWith("zh")
		? `${DESIGN_SKILL_DRAFT}请按「${system.name}」风格设计。我想做：`
		: `${DESIGN_SKILL_DRAFT}Design this in the "${system.name}" style. I want to build: `;
}

/**
 * 参考包的文件清单（`INDEX.md`），skill 指示 agent 先读它。
 *
 * 逐个列出**实际落盘成功**的文件而不是让 agent 自己 ls——截图这类二进制可能因网络
 * 原因缺席，清单必须反映真实落点；顺带给翻项目的人一句「这个目录是干什么的」。
 */
export function buildResourceIndex(systemName: string, written: readonly string[]): string {
	return [
		`# ${systemName} — style reference pack`,
		"",
		"Written by the Vetta design sidebar when the user picked this style.",
		"Files in this pack:",
		"",
		...written.map((path) => `- ${path}`),
		"",
	].join("\n");
}

/** 清单文件名；skill 的 design-resources 协议按这个名字点名。 */
export const RESOURCE_INDEX_FILE = "INDEX.md";

/** 下载二进制资源的超时：截图这类文件不大，卡住不如放弃。 */
const BINARY_TIMEOUT_MS = 20_000;

/**
 * 把一套体系的全部资源按仓库里的目录结构落到 `targetRoot`。
 *
 * 文本随清单已经到手，直接写；二进制现下载。**单份资源失败不影响其它** —— 少一张截图
 * 也比整个流程失败强，规范和主题（文本）总是能落下来。返回实际写成功的相对路径。
 */
async function writeResources(system: DesignSystem, targetRoot: string): Promise<string[]> {
	const ctx = getPluginCtx();
	const written: string[] = [];
	for (const resource of system.resources) {
		const target = `${targetRoot}/${resource.path}`;
		try {
			const slash = target.lastIndexOf("/");
			if (slash > 0) await ctx.fs.createDirectory(target.slice(0, slash));
			if (resource.encoding === "text") {
				// spec 落盘时补上 frontmatter：出处和许可跟着资料走，agent 把它拷进设计时一并带过去。
				const content = resource.role === "spec" ? designMdWithFrontmatter(system) : resource.content;
				await ctx.fs.writeFile(target, content);
			} else {
				const response = await ctx.network.request<string>({
					url: resource.url,
					method: "GET",
					responseType: "base64",
					timeoutMs: BINARY_TIMEOUT_MS,
				});
				if (!response.ok || typeof response.body !== "string") continue;
				await ctx.fs.writeFile(target, response.body, "base64");
			}
			written.push(resource.path);
		} catch {
			// 单份资源写不下来就跳过，别让整个「从风格开工」失败。
		}
	}
	return written;
}

/**
 * 建项目 + 落参考资料 + 进新会话。
 *
 * 资料按体系 id 分目录：以后同一个项目里可以并存多份参考，互不覆盖。
 */
export async function startDesignFromSystem(
	system: DesignSystem,
	projectName: string,
	locale: string,
): Promise<StartedFromSystem> {
	const ctx = getPluginCtx();
	// 项目名由用户在对话框里给：他点的是风格，不是在给项目起名。
	const { cwd } = await createDesignProject(projectName);
	const resourcesDir = `${DESIGN_RESOURCES_DIR}/${system.id}`;
	const written = await writeResources(system, `${cwd}/${resourcesDir}`);
	// 清单跟着资料走：一份都没落下来就不写，免得 skill 引着 agent 去读一个空包。
	if (written.length > 0) {
		await ctx.fs
			.writeFile(`${cwd}/${resourcesDir}/${RESOURCE_INDEX_FILE}`, buildResourceIndex(system.name, written))
			.catch(() => {});
	}
	await ctx.official.navigation.open({
		target: "new-session",
		cwd,
		draft: buildStyleStartDraft(system, locale),
	});
	return { cwd, resourcesDir, written };
}
