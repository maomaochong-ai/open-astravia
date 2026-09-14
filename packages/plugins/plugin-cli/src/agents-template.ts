/**
 * 随脚手架落地的 Agent 说明书。
 *
 * 它替代的是「把开发知识写死在工作台插件的 skill 里」那套做法：那份 skill 只有 Vetta
 * 自己的 Agent 读得到，而且每加一个能力就要改一次、还要等 App 发版才到用户手里。这里
 * 反过来——工程自带说明书，说明书只说「去哪读手册」，手册随 SDK 版本进 node_modules。
 * 因此任何 Agent（Claude Code、Cursor、Vetta 自己）在任何陌生目录都能自举，而且读到的
 * 永远是这个工程实际编译所针对的那份合同。
 */
export function renderAgentsGuide(input: { pluginId: string; displayName: string; inHub: boolean }): string {
	const hubSection = input.inHub
		? `
## 这是能力市场仓库里的一个插件

仓库根有 \`.vetta/marketplace.json\`，它索引了本仓库的全部能力。改动本插件的 **version、
permissions、commands 或 pluginApiVersion** 之后，那份索引也要跟着更新，否则市场上装到的
是旧元数据。

命令在任何子目录执行都作用于「最近的那个插件」，所以先 \`cd\` 进要改的插件目录再动手。
`
		: "";

	return `# ${input.displayName}

Vetta 桌面插件工程。**先读手册再写代码**——不要凭记忆写 SDK API，这套合同变化很快。

## 第一步：找到并阅读手册

\`\`\`bash
npx vetta-plugin-cli docs
\`\`\`

它打印出随 \`@vetta-org/plugin-sdk\` 一起装进 \`node_modules\` 的手册目录**绝对路径**，以及
这份手册对应的 SDK 版本。**不要硬编码这个路径**：工作区可能把依赖提升到仓库根，一仓多插件
时各插件还可能钉不同的 SDK 版本。

拿到路径后，用 read 工具按这个顺序打开：

| 顺序 | 文件 | 何时读 |
| --- | --- | --- |
| 1 | \`README.md\` | 总是先读：能力矩阵、信任模型、导航 |
| 2 | \`getting-started.md\` | 首次写代码、构建、安装调试 |
| 3 | \`manifest.md\` | 写/改 \`plugin.json\`、贡献智能体与团队 |
| 4 | \`permissions.md\` | 选定权限列表之前 |
| 5 | 按扩展点选读 | \`ui-slots.md\` / \`conversation-and-agent.md\` / \`message-cards.md\` / \`mcp.md\` / \`ai.md\` / \`browser.md\` / \`app-actions.md\` |

实现任一扩展点**之前**再读对应那章。手册是唯一真源，本文件与它冲突时以手册为准。

## 开发闭环

\`\`\`bash
npm install
npm run dev            # Vite + Module Federation 开发服务器
npm run build          # 产出 dist/
npm run install:vetta  # 打包并装进正在运行的 Vetta（需要 Vetta 已启动）
npx vetta-plugin-cli watch   # 开热更新：宿主改从本工程目录加载，改完即生效
\`\`\`

\`install:vetta\` 走 \`vetta-plugin-cli add .\`：它找到本工程打出来的归档，交给正在运行的
Desktop 校验、授权、安装。它**不会**直接写 \`~/.vetta/plugins\`。

装完若提示有 pending 版本，用 \`npx vetta-plugin-cli reload ${input.pluginId}\` 让宿主应用它。

开发期建议开热更新（\`watch\`）：之后改源码即时生效，不用每次重新打包安装。改 \`plugin.json\`
的权限或命令声明时仍需重新安装一次，让宿主把授权落盘。\`watch --stop\` 关闭。

## 不可违反的几条

- **样式只用 Tailwind \`className\`**。禁止新建业务 CSS、禁止在 \`style.css\` 里写 \`button\`/\`div\`/\`*\`
  这类选择器——插件与宿主共享同一个页面，全局选择器会污染整个 UI。
- **可能失败的路径必须上报**：读文件、解析、网络、外部库的 catch 里调用
  \`ctx.ui.notify({ message, error })\`（无需权限）。禁止只写死「失败」文案并丢掉原始 error。
- **权限按需最小声明**。构建期会校验产物用到的能力与 \`plugin.json\` 的声明是否匹配，缺了直接
  构建失败。但 UI 槽位不在这条校验里——那类缺权限在运行时只是静默跳过，所以对着手册核对。
- **不要写 \`agent_mode\`**（已废弃，无运行时语义）。想收窄某个工具的使用场景，把「何时不该用它 +
  替代做法」写进该工具 description 的反向触发段。
- **顶层不要出现依赖共享 React 的 JSX**，放进组件或 \`activate\` 内（Module Federation 的加载时序）。
- 依赖用 registry 上已发布的 semver，不要 \`workspace:*\`。
${hubSection}
## 信息不足时

插件 id、展示名、要用哪些权限、功能边界、是否立刻安装——**问用户**，不要自己假定。
`;
}
