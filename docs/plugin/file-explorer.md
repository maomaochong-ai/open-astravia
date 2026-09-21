# 文件列表扩展

`ctx.fileExplorer` 扩展宿主自带的项目文件列表。插件可以贡献右键菜单、工具栏动作和文件装饰，也可以读取当前工作区/选中项、定位文件、刷新目录并订阅文件事件。

文件列表 API 只暴露文件名、路径、类型、大小和修改时间等元数据。读取文件内容仍需 `fs.read`，修改文件仍需 `fs.write`。

## 权限

| 权限 | 能力 |
| --- | --- |
| `ui.file-explorer.context-menu` | 注册文件或目录右键菜单动作 |
| `ui.file-explorer.toolbar` | 注册文件列表顶部工具栏动作 |
| `ui.file-explorer.decorations` | 注册状态装饰和可选文件图标主题 |
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

省略菜单项的 `icon` 时，宿主使用 `plugin.json#icon`；传入 React 节点可只覆盖这一项。

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

省略工具栏动作的 `icon` 时同样继承插件图标；传入 React 节点可只覆盖这一项。

工具栏动作只在文件列表存在活动工作区时显示。`selection` 是当前文件列表选中项的只读快照。

## 文件装饰

文件装饰不是插件入口：它不会从 `plugin.json#icon` 自动继承。它适合表达 Git、诊断、同步等
会动态变化的状态；图标主题则负责文件类型与文件夹外观。两者独立解析，所以用户选择图标主题后，
状态徽标、颜色和提示仍会保留。

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
      color: status === "M" ? "warning" : "success",
      propagate: true,
    };
  },
  onDidChangeDecorations(listener) {
    return gitStatusStore.subscribe((entries) => listener(entries));
  },
});
```

`provideDecoration` 在文件树渲染时同步调用，必须快速且无副作用。网络、命令和文件读取应提前完成并缓存在插件内。状态变化时用 `onDidChangeDecorations` 通知宿主重新计算，不需要为改一个徽标刷新文件系统；事件也可以携带尚未展开的后代条目，让父目录提前显示聚合状态。传 `undefined` 表示全部失效。多个提供者命中时，宿主采用 `priority` 最高且返回非空结果的提供者。

装饰可返回：

- `icon`: 兼容旧插件的单条目图标覆盖；新插件优先注册图标主题
- `badge`: 文件名后的紧凑状态文本，建议一到两个字符
- `tooltip`: 文件行提示信息
- `color`: `foreground`、`muted`、`accent`、`success`、`warning` 或 `error` 语义色
- `faded`: 降低文件名透明度
- `strikethrough`: 给文件名加删除线
- `propagate`: 将该状态聚合到当前工作区内的父目录

插件不能注入任意 CSS，也不能改变行高、字体、缩进、排序或交互区域；这些仍由宿主控制，以保证主题、可访问性和虚拟列表稳定。

## 文件图标主题

图标主题采用类似 VS Code 的声明式关联，但图标值仍是共享 React 运行时中的节点。主题可以为默认文件/文件夹、精确文件名、扩展名、文件夹名和展开状态设置图标，并为浅色、深色和高对比模式提供覆盖。用户在文件列表的显示设置中显式选择主题；插件停用后宿主回退到内置图标，重新启用时会恢复用户原来的选择。

```tsx
ctx.fileExplorer.registerIconTheme({
  id: "product-icons",
  label: "Product Icons",
  iconDefinitions: {
    file: <FileIcon />,
    folder: <FolderIcon />,
    folderOpen: <FolderOpenIcon />,
    typescript: <TypeScriptIcon />,
    config: <ConfigIcon />,
  },
  file: "file",
  folder: "folder",
  folderExpanded: "folderOpen",
  fileNames: {
    "package.json": "config",
  },
  fileExtensions: {
    ts: "typescript",
    "d.ts": "typescript",
  },
});
```

关联优先级为精确文件名、最长复合扩展名（如 `d.ts`）、普通扩展名、默认文件图标；文件夹按精确名称后回退默认图标。名称匹配不区分大小写。所有引用必须指向同一主题的 `iconDefinitions`，无效输入会在注册边界直接报错。

状态装饰事件、语义样式和 `registerIconTheme` 要求插件声明 `pluginApiVersion: ^2.7.0`，旧的 `icon` / `badge` / `tooltip` provider 保持兼容。

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
