# 文件列表扩展

`ctx.fileExplorer` 扩展宿主自带的项目文件列表。插件可以贡献右键菜单、工具栏动作和文件装饰，也可以读取当前工作区/选中项、定位文件、刷新目录并订阅文件事件。

文件列表 API 只暴露文件名、路径、类型、大小和修改时间等元数据。读取文件内容仍需 `fs.read`，修改文件仍需 `fs.write`。

## 权限

| 权限 | 能力 |
| --- | --- |
| `ui.file-explorer.context-menu` | 注册文件或目录右键菜单动作 |
| `ui.file-explorer.toolbar` | 注册文件列表顶部工具栏动作 |
| `ui.file-explorer.decorations` | 注册图标、徽标和提示信息提供者 |
| `workspace.read` | 查询根目录/选中项、定位、刷新和订阅事件 |

上述 API 缺权限时会抛 `Plugin permission denied: <permission>`。它们不会隐式授予 `fs.read` 或 `fs.write`。

## 右键菜单

```tsx
ctx.fileExplorer.registerContextMenuAction({
  id: "format-file",
  label: "%explorer.format%",
  icon: <span className="icon-[solar--magic-stick-3-linear] h-3.5 w-3.5" />,
  order: 50,
  when: {
    resourceType: "file",
    extensions: ["ts", "tsx"],
  },
  async run({ entry, workspaceRoot }) {
    // 读取内容需要插件另外声明 fs.read。
    const source = await ctx.fs.readFile(entry.path);
    console.info(workspaceRoot?.path, source.content.length);
  },
});
```

`when` 支持：

- `resourceType`: `file` 或 `directory`
- `extensions`: 不带点的扩展名数组，大小写不敏感
- `fileNames`: 精确文件名数组，大小写不敏感

多个动作按 `order` 升序显示，缺省为 `100`。

## 工具栏动作

```tsx
ctx.fileExplorer.registerToolbarAction({
  id: "sync",
  label: "%explorer.sync%",
  icon: <SyncIcon />,
  async run({ workspaceRoot, selection }) {
    await synchronize(workspaceRoot.path, selection.map((entry) => entry.path));
  },
});
```

工具栏动作只在文件列表存在活动工作区时显示。`selection` 是当前文件列表选中项的只读快照。

## 文件装饰

```tsx
ctx.fileExplorer.registerDecorationProvider({
  id: "git-status",
  priority: 100,
  when: { resourceType: "file" },
  provideDecoration(entry) {
    const status = statusByPath.get(entry.path);
    if (!status) return null;
    return {
      badge: status,
      tooltip: `%explorer.gitStatus.${status}%`,
    };
  },
});
```

`provideDecoration` 在文件树渲染时同步调用，必须快速且无副作用。网络、命令和文件读取应提前完成并缓存在插件内；状态变化后可调用 `ctx.fileExplorer.refresh()` 触发目录刷新。多个提供者命中时，宿主采用 `priority` 最高且返回非空结果的提供者。

装饰可返回：

- `icon`: 替换内置文件/文件夹图标的 React 节点
- `badge`: 文件名后的紧凑状态文本，建议一到两个字符
- `tooltip`: 文件行提示信息

## 工作区、选择与定位

```ts
const roots = ctx.fileExplorer.getWorkspaceRoots();
const selection = ctx.fileExplorer.getSelection();

await ctx.fileExplorer.reveal("C:/workspace/src/index.ts", {
  select: true,
  focus: true,
});

await ctx.fileExplorer.refresh();        // 刷新根目录
await ctx.fileExplorer.refresh(dirPath); // 刷新工作区内指定目录
```

当前版本的内置文件列表只有一个活动根目录，因此 `getWorkspaceRoots()` 返回零项或一项。`reveal` 和 `refresh(path)` 只接受当前工作区内路径。

## 事件

```ts
const selectionHandle = ctx.fileExplorer.onDidChangeSelection((selection) => {
  console.info("selection", selection);
});

const filesHandle = ctx.fileExplorer.onDidChangeFiles((changes) => {
  for (const change of changes) console.info(change.type, change.path);
});
```

文件事件类型为 `changed`、`created`、`deleted` 或 `moved`；`moved` 额外包含 `oldPath`。文件系统监听只能确定目录发生变化时，宿主会发送该目录的 `changed` 事件。

所有注册和订阅都返回 `Disposable`。插件可以主动调用 `dispose()`；插件停用、重载或卸载时宿主也会统一清理贡献和订阅。
