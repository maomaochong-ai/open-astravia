/**
 * 随脚手架落地的 Agent 说明书。
 *
 * 它替代的是「把开发知识写死在工作台插件的 skill 里」那套做法：那份 skill 只有 Vetta
 * 自己的 Agent 读得到，而且每加一个能力就要改一次、还要等 App 发版才到用户手里。这里
 * 反过来——工程自带说明书，说明书只说「去哪读手册」，手册随 SDK 版本进 node_modules。
 * 因此任何 Agent（Claude Code、Cursor、Vetta 自己）在任何陌生目录都能自举，而且读到的
 * 永远是这个工程实际编译所针对的那份合同。
 *
 * **这里刻意只留指引，不留知识。** 写进这个文件的每一条规则都会在所有存量工程里就地凝固：
 * 它是 `init` 当天的快照，之后既不会自更新，用户也没有理由回来看它。规则属于手册——手册
 * 随 SDK 升级一起到位。这个文件越薄，需要回头迁移老仓库的理由就越少。
 *
 * 单位是插件目录本身：外面是能力市场仓库、是单插件仓库、还是一堆别的东西，都不影响这里。
 */

/**
 * 说明书的版本戳。
 *
 * `docs` 读它来判断一份说明书是不是旧的——没有这个戳，「该不该刷新」就只能靠人记得，而这
 * 恰恰是它凝固的原因。**改动模板内容时必须一并推进它**，否则存量工程不会收到提示。
 */
export const AGENTS_GUIDE_REVISION = 3;

/** 从一份 AGENTS.md 正文里读出版本戳；不是本模板生成的（或早于版本戳）时返回 undefined。 */
export function readAgentsGuideRevision(content: string): number | undefined {
	const match = /<!--\s*vetta-guide-revision:\s*(\d+)\s*-->/.exec(content);
	if (!match) return undefined;
	return Number(match[1]);
}

/**
 * 渲染常用命令块。
 *
 * 只列工程真有的 script：模板写死 `npm run dev` / `install:vetta`，老工程和自定义工程未必有，
 * 照着跑就是一句 "Missing script"。读不到 package.json 时退回 CLI 直连命令——它们不依赖工程脚本。
 */
function renderCommands(pluginId: string, scripts: readonly string[]): string {
	const known: readonly (readonly [string, string])[] = [
		["dev", "npm run dev            # 开发服务器"],
		["build", "npm run build          # 产出 dist/"],
		["install:vetta", "npm run install:vetta  # 打包并装进正在运行的 Vetta（需要 Vetta 已启动）"],
	];
	const lines = known.filter(([name]) => scripts.includes(name)).map(([, line]) => line);
	if (!scripts.includes("install:vetta")) {
		lines.push("npx vetta-plugin-cli add .       # 打包并装进正在运行的 Vetta");
	}
	return [
		...lines,
		"",
		"npx vetta-plugin-cli watch       # 热更新：宿主改从本工程目录加载，改完即生效",
		`npx vetta-plugin-cli reload ${pluginId}   # 装完提示有 pending 版本时用它`,
		"npx vetta-plugin-cli uninstall   # 卸载（省略 id 即本工程对应的插件）",
		"npx vetta-plugin-cli sync        # 在 hub 仓库根上跑：把索引与各能力目录对账",
	].join("\n");
}

export function renderAgentsGuide(input: {
	pluginId: string;
	displayName: string;
	/** 工程 package.json 里实际存在的 script 名；缺省按脚手架的那套算。 */
	scripts?: readonly string[];
}): string {
	return `<!-- vetta-guide-revision: ${AGENTS_GUIDE_REVISION} -->
# ${input.displayName}

Vetta 桌面插件工程（插件 id：\`${input.pluginId}\`）。

**本文件不讲规则，只告诉你去哪读。** 规则在手册里，手册随 SDK 升级；写在这里的任何一条都会
停在这个工程创建那天。两者冲突时一律以手册为准。

## 第一步：装依赖，找到手册

\`\`\`bash
npm install
npx vetta-plugin-cli docs --check-latest
\`\`\`

\`npm install\` 必须先跑：\`vetta-plugin-cli\` 是 \`@vetta-org/plugin-cli\` 的命令名，装完才在
\`node_modules/.bin\` 里。还没装就想跑，用全名 \`npx @vetta-org/plugin-cli docs\`。

它打印手册目录的**绝对路径**、手册对应的 SDK 版本，以及本工程与所属 hub 的位置。
**不要硬编码这个路径**：工作区可能把依赖提升到仓库根，一仓多插件时各插件还可能钉不同版本。

输出里出现 \`Manual is behind\` 或 \`This brief is stale\` 就按它给的命令升级，再重跑一次。

## 第二步：按顺序读手册

| 顺序 | 文件 | 何时读 |
| --- | --- | --- |
| 1 | \`README.md\` | **总是先读**：能力矩阵、信任模型、**不可违反的红线**、导航 |
| 2 | \`getting-started.md\` | 首次写代码、构建、安装调试 |
| 3 | \`manifest.md\` | 写/改 \`plugin.json\`、贡献智能体与团队 |
| 4 | \`permissions.md\` | 选定权限列表之前 |
| 5 | 按扩展点选读 | \`ui-slots.md\` / \`conversation-and-agent.md\` / \`message-cards.md\` / \`mcp.md\` / \`ai.md\` / \`browser.md\` / \`app-actions.md\` / \`styling-and-pitfalls.md\` |

实现任一扩展点**之前**再读对应那章，不要凭记忆写 SDK API——这套合同变化很快。

## 常用命令

\`\`\`bash
${renderCommands(input.pluginId, input.scripts ?? ["dev", "build", "install:vetta"])}
\`\`\`

细节都在 \`getting-started.md\`。\`docs\` 打印了 \`Marketplace index:\` 就说明这个目录之上有能力
市场索引，改完 \`version\` / \`permissions\` / \`pluginApiVersion\` 后要回仓库根跑 \`sync\`。

## 信息不足时

插件 id、展示名、要用哪些权限、功能边界、是否立刻安装——**问用户**，不要自己假定。
`;
}
