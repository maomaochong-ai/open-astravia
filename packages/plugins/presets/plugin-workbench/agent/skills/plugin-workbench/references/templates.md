# 常用插件模板（实现前对照文档）

下列片段是起点；**字段与 API 以手册全文为准**（`docs --json` 的 `manualDir`，见 `doc-index.md`）。实现前至少已读 `getting-started.md` + 对应扩展点文档。

## 样式（强制）

- **只用 Tailwind `className`**；`style.css` **仅**保留 theme + utilities 入口。
- **禁止**新建业务 `.css`、禁止在 style.css 里写 `button`/`div`/`*` 等选择器（会注入宿主全局，污染 UI）。
- 详见 `styling-and-pitfalls.md`。

## A. 纯引导词（无 UI、无工具）

`plugin.json` 增加 `guidingWords`；`permissions: []`；`src/index.tsx` 可空 `activate`。

见 `manifest.md` → guidingWords。

## B. Activity 面板 Tab

权限：`ui.slot.activity-tab`（读会话则再加 `agent.session.read`）。

```tsx
import { definePlugin } from "@vetta-org/plugin-sdk";
import "./style.css"; // Tailwind pipeline only

function Panel() {
  return (
    <div className="flex h-full flex-col gap-2 p-3 text-sm text-foreground">
      Hello
    </div>
  );
}

export default definePlugin({
  activate(ctx) {
    ctx.ui.registerActivityTab({
      id: "main",
      label: "我的面板",
      component: Panel,
      scope_use: ["project", "conversation"], // fail-closed：必须声明
    });
  },
});
```

见 `ui-slots.md` → registerActivityTab。

## C. 注册 Agent 工具

权限：`agent.tools.register` + `agent.toolHandler.execute`。

```tsx
ctx.agent.registerTool({
  id: "my_tool",
  name: "my_tool",
  description: "何时调用、参数含义写清楚",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  scope_use: ["project", "conversation"],
  async execute({ query }) {
    return { content: [{ type: "text", text: String(query) }] };
  },
});
```

见 `conversation-and-agent.md` → 注册 Agent 工具。若要消息卡片，读 `message-cards.md`。

## D. 文件预览

权限：`ui.slot.file-preview`。仅当宿主内置未覆盖的扩展名才生效。

**布局**：预览 UI 必须留在预览壳内。禁止 `fixed` / 视口定位与 `z-[2147483647]`；面板内浮层用根 `relative` + 子 `absolute`。全局浮层 → `registerGlobalSlot`；Toast → `notify`。见 `styling-and-pitfalls.md` → 面板类 slot 布局边界。

解析失败时**必须** `notify({ message, error })`（无权限），便于用户复制堆栈：

```tsx
import { definePlugin, type PluginFilePreviewProps, type PluginUiApi } from "@vetta-org/plugin-sdk";
import { useEffect, useState } from "react";
import "./style.css";

let notify: PluginUiApi["notify"];

function Preview({ file }: PluginFilePreviewProps) {
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    file.readBytes()
      .then(async (bytes) => {
        // parse bytes...
        if (!cancelled) setError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setError("无法解析此文件");
        notify({ message: "无法解析此文件", error: err });
      });
    return () => {
      cancelled = true;
    };
  }, [file]);
  if (error) return <div className="p-4 text-sm text-destructive">{error}</div>;
  return <div className="p-4 text-sm text-foreground">…</div>;
}

export default definePlugin({
  activate(ctx) {
    notify = ctx.ui.notify;
    ctx.ui.registerFilePreview({ extensions: ["xyz"], component: Preview });
  },
});
```

见 `ui-slots.md` → registerFilePreview、**全局通知 notify**。

## E. 输入栏 toggle

权限：`ui.slot.input-action`。默认是 soft metadata；硬隔离用 `hardIsolation`（见宿主 ADR-0041，用户插件默认不要开）。

见 `ui-slots.md` → registerInputAction。

## F. 插件 skill / system prompt 片段

`plugin.json`：

```json
"permissions": ["agent.skills.control", "agent.systemPrompt.write"],
"agent": {
  "skillPaths": ["agent/skills"],
  "systemPrompt": { "promptPaths": ["agent/prompts/extra.md"] }
}
```

见 `manifest.md` → agent 侧贡献。

## G. 贡献智能体 / 团队（清单声明，无需权限）

人设、头像、提示词由插件维护；宿主铺成普通档案，停用插件时档案灰着留在原地。

```json
"agent": {
  "agents": [
    {
      "id": "designer",
      "name": "%agent.designer.name%",
      "description": "%agent.designer.description%",
      "mentionHandle": "designer",
      "avatar": "agent/agents/designer.webp",
      "systemPromptPath": "agent/agents/designer.md",
      "abilities": "all"
    }
  ],
  "teams": [
    {
      "id": "design-team",
      "name": "%team.design.name%",
      "members": [{ "agent": "designer", "responsibility": "Owns the visual result end to end." }],
      "workflowPath": "agent/workflows/design-team.md"
    }
  ]
}
```

- 团队成员 **只能**写本插件 `agents[]` 里的 id；引用别的插件或宿主角色会让整支团队被跳过。
- 头像单张 ≤ 512 KB；提示词优先用 `systemPromptPath` 指向 Markdown。
- 迁移已有人设时用 `legacyIds` 认领用户已有档案，别铺重复的一份。

见 `manifest.md` → 贡献智能体与团队。

## H. 新会话上下文区（落地区素材）

权限：`ui.slot.new-session-context`（缺权限 **warn+noop**）；要读草稿再加 `conversation.draft.read`。

```tsx
ctx.ui.registerNewSessionContext({
  id: "design-styles",
  label: "%tab.label%",
  // 至少声明一条激活条件，且只能写本插件自己的智能体 / skill / MCP。
  activateWhen: { agents: ["designer"], skills: ["vetta-ui-design"] },
  width: "wide", // 画廊类内容才用 wide；补充说明用默认的 "input"
  render: (context) => <StyleLibrary context={context} />,
});
```

- `render` 拿到的 `context` 会继续生长：按需解构，别假定它只有那几个键。
- 只能回写输入栏（`composer.attach` / `insertText`），**没有**「直接发送」。
- 未授予 `conversation.draft.read` 时 `context.draft` 恒为空串，别据此判断用户有没有打字。

见 `ui-slots.md` → 新会话上下文区 registerNewSessionContext。

## 样式与陷阱（必看）

- **样式只 Tailwind className**；勿手写业务 CSS（污染全局）— `styling-and-pitfalls.md`
- **面板类 slot 禁止 viewport `fixed` / 超高 z-index**；浮层用 `absolute` 或 `registerGlobalSlot` / `notify` — `styling-and-pitfalls.md` → 面板类 slot 布局边界
- 顶层禁止依赖共享 React 的 JSX（放进组件或 activate 内）
- 改代码不生效：bump `plugin.json` version + reload
- **可能失败的路径必须 `ctx.ui.notify({ message, error })`**，禁止吞掉 error — `ui-slots.md` → notify
- 用户工程依赖用 **registry semver** 的 `@vetta-org/plugin-sdk` / `@vetta-org/plugin-vite`，禁止 `workspace:*`
