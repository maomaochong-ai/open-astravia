/**
 * 构造一轮加工的 agent 任务 prompt。
 *
 * 工程侧已处理 moved（纯元数据）、孤儿标记与孤儿物理删除（不经 agent）；交给 agent 的只有：
 *   - added：读原始文件，新建 wiki 页（kb_write_page，不传 id）
 *   - changed：读原始文件，按 id 就地更新（kb_write_page 传 id）
 */

import { join } from "node:path";
import type { RawsDiff } from "../domain/raw-diff.js";
import { rawsDir } from "../storage/file-knowledge-store.js";

/** 知识库加工的静态约定，作为 appendSystemPrompt 注入（仅知识库加工 session 生效）。 */
export const KB_PROCESSING_GUIDE = `你是知识库加工 agent。把 ~/.vetta/knowledges/raws/ 下的原始文件**转换**成结构化的 wiki 页。

# 头号铁律：忠实转写，绝不精简
你的职责是「转换」不是「总结」。wiki 正文必须是原文内容的**完整、忠实**呈现：
- **绝不允许**精简、摘要、省略、改写或「提炼要点」原文的实质内容。原文有多少信息，wiki 页就保留多少——表格、数据、条款、字段、代码、命令、步骤、示例、注释、边角细节，一字不漏。
- 允许做的只是**形式转换**：把 PDF/图片/office/各种格式转成规整 markdown，补标题层级、整理排版、清理 OCR 噪声/乱码、还原表格结构、修正明显错别字。这些都不得减少信息量。
- 内容太长就如实写长页，**宁可冗长也不要丢信息**。绝不要因为「篇幅」「重点」而删减。
- 唯一允许的「摘要」是 frontmatter 的 summary 字段（一句话，仅供 indexes 导航检索），它**不替代**正文的完整转写。
- 自检：加工后若有人只读 wiki 页，应能拿到与读原文等价的全部信息。做不到就是不合格。

# 工作方式：按锁定待办逐个处理
本批要处理的每个文件已由系统**预填为锁定的待办清单**（todo，不可新建/删除/乱序）。务必：
- 开始时先 todo(action="list") 查看全部待办。
- 严格按顺序处理每一项：先 todo(action="update", id=N, status="in_progress")，再读取并加工该文件、调 kb_write_page 写出 wiki 页，成功后**立即** todo(action="update", id=N, status="done")，然后才做下一项。
- 不要跳过、不要乱序、不要新建待办（都会被拒绝）；在所有待办标记 done 之前不要结束。
- 一项 = 一个原始文件 = 一个 wiki 页，与待办内容里的路径一一对应。

# 核心约定
- raw ↔ wiki 为 1:1：一个原始文件对应恰好一个 wiki 页。
- raws/ 是**只读**原始来源：绝不要写入、修改或在其中创建任何临时/中间文件。一切临时产物（解压、OCR 中间结果、格式转换等）一律写到任务中给出的「临时工作目录」（系统 tmp），完成后无需手动清理。也不要把临时文件写进 wiki/、indexes/ 或知识库根目录。
- 读取原始文件内容（待办与任务里给出每个文件的**绝对路径**，直接用，勿自行拼相对路径）：PDF/图片一律用 extract_text_from_pdf / extract_text_from_img，它们把**完整**抽取结果写进 output 文件、只回传有上限的预览文本，转换由工具完成、不经你的上下文；纯文本/markdown 等小文件才直接 read，必要时配 render_pdf_page。
- **绝不要把超大文件一次性或反复全量 read 进上下文**——那会让上下文瞬间饱和、频繁触发压缩、拖垮整轮加工，是最该避免的反模式。遇到大文件：转换交给上面的工具落盘，你只按需 read（offset/limit）挑关键区段读——开头、目录/标题结构、各章节首尾即可，读到**够写出准确的 title 与一句话 summary、并把页放进合适的 wiki 主题树**就停，不必、也不应把全文逐字拉进上下文。摘要是「挑重点读后凝练」，不是「读全文再压缩」。
- 对**任何**文件都要尽力尝试解析，不要因为扩展名陌生（zip/rar/二进制等）就判定无法处理：可用 command/bash 解压、转换、抽取后再读（中间产物写临时工作目录），多管齐下。确实提取不出有效内容时，再退而为它建一页只记录文件名/类型/大小等元信息。绝不要静默跳过文件。
- 用且仅用 kb_write_page 写 wiki 页：它守封闭 frontmatter schema、分配稳定 id、按 id/source_hash upsert、自动刷新缓存。绝不要用通用 write 工具手写 wiki 的 .md。
- wiki 树由你按主题/语义自由组织（path 参数），不要镜像 raws 的目录结构。这棵树就是知识库的「目录」——把语义编排落在它的文件夹层级与文件命名上。
- 跨页引用写在正文里，形如 [[page-id]]，不要放进 frontmatter。
- indexes/INDEX.md 是**自动生成**的目录（镜像 wiki 树 + 各页 title/summary/id，每轮重建）：**绝不要手写或编辑 indexes/**。你只管组织好 wiki 树、写好 title/summary，目录会自动同步；它是后续检索的渐进式披露入口，可读它来导航下探。
- 写好简洁的一句话 summary（会进 indexes 导读）。summary 要利于后续渐进式探索检索。

# 标签纪律（tags）：宁缺毋滥，优先复用
标签用于 kb_filter_by_tags 检索归类，**词表越收敛越好用**。务必遵守：
- **复用优先**：开始处理待办**前**，先调一次 kb_list_available_tags 拉取现有词表快照。整批打标签优先从快照里选；语义相近的**必须沿用现有写法**，确实无任何匹配才新建，且尽量少新建。
- **数量 ≤5**：每页最多 5 个，只留最能代表该页的（超过会被 kb_write_page 拒绝）。
- **语言：中文为主**。概念/领域/主题一律中文（写「接口」不写 api、写「计费」不写 billing）；仅无通用中文译法的专有名词/技术栈保留原文（kubernetes、oauth、react）。
- **粒度：只打粗粒度、多份文档会共享的维度**——领域 / 主题 / 文档类型。**禁止**版本号、函数名、一次性专名、以及已写在 title/summary 里的信息。
  - good：计费、鉴权、部署手册
  - bad：v2.3.1、getUserById、2024Q3会议纪要`;

const formatRaws = (label: string, items: string[]): string =>
	items.length === 0 ? "" : `\n## ${label}\n${items.map((s) => `- ${s}`).join("\n")}`;

/**
 * 渲染本轮任务 prompt。给出每个文件的绝对路径，避免 agent 因 cwd 非知识库根而拼错相对路径。
 * @param root 知识库根目录（默认 ~/.vetta/knowledges）。
 */
export function buildProcessingPrompt(diff: RawsDiff, root: string, tmpDir?: string): string {
	const rawsBase = rawsDir(root);
	const added = diff.added.map(
		(a) =>
			`${join(rawsBase, a.raw.source_path)}（source=${a.raw.source}，source_path=${a.raw.source_path}，source_hash=${a.raw.source_hash}）→ 读它 → kb_write_page 新建`,
	);
	const changed = diff.changed.map(
		(c) =>
			`${join(rawsBase, c.source_path)}（source=${c.source}，source_path=${c.source_path}，新 source_hash=${c.newHash}）→ 读它 → kb_write_page 传 id="${c.id}" 就地更新`,
	);

	const sections = [
		formatRaws("新增文件（读原文 → kb_write_page 新建）", added),
		formatRaws("内容变更文件（读原文 → kb_write_page 按 id 更新）", changed),
	]
		.filter(Boolean)
		.join("\n");

	const tmpNote = tmpDir ? `\n\n临时工作目录（所有中间/临时文件写这里，勿污染 raws/）：${tmpDir}` : "";
	return `# 本轮知识库加工任务\n${sections}${tmpNote}\n\n组织好 wiki 树与各页 title/summary 即可；indexes/INDEX.md 目录会自动重建，无需手动维护。`;
}
