# 浮层主题化基座

Root global overlays 包含对话框、抽屉、审批确认、全局提示和文件预览等跨页面 UI。它们需要支持图片边框、背景纹理和组件替换，但不能让主题接管审批、登录、文件系统或插件生命周期等应用逻辑。

## 分层策略

当前采用：

```txt
connected container
  读取 atom / IPC / router / approval center
  解析输入并构造 approve payload
  使用 useThemeComponent 解析可替换 view

props-driven view
  只接收标题、文案、状态、列表、字段、回调
  渲染 Dialog / Drawer / motion overlay
  提供 ThemeSurface 装饰层
```

connected container 留在 desktop 内部。主题替换的是 props-driven view，而不是审批中心、插件宿主或 IPC 接入层。

## 已接入的覆盖点

当前 root overlay 已按真实 UI 组件接入 component override，而不是提供无意义的大空壳：

```txt
root.confirmDialogView
root.loginDialogView
root.filePreviewDialogView
root.flowingSendDialogView
root.workflowCompleteDialogView
root.updateRestartDialogView
root.knowledgeDropOverlayView
root.genericActionApprovalView
root.approval.navigationOpenView
root.approval.appearanceDrawerView
root.approval.schedulerEditView
root.approval.schedulerActionView
root.approval.batchTasksFrameView
```

仍保留 top-level override 的入口，例如 `root.loginDialog`、`root.approval.batchTasksProject`。这些入口适合主题完整替换某个 connected overlay，但默认建议优先替换 props-driven view。

`ActionApprovalCenter` 和 `PluginGlobalSlotHost` 是应用集成层，不作为主题 UI 替换点。它们负责监听、调度、生命周期和插件 slot 挂载，不表达可复用视觉组件。

## 已接入的 Surface Slot

当前可用的 root overlay surface：

```txt
root.confirmDialog.panel
root.filePreviewDialog
root.filePreviewDialog.panel
root.flowingSendDialog.panel
root.genericActionApproval.panel
root.knowledgeDropOverlay
root.loginDialog.panel
root.approval.appearance.panel
root.approval.batchTasks.panel
root.approval.navigationOpen.panel
root.approval.schedulerAction.panel
root.approval.schedulerEdit.panel
root.updateRestartDialog.panel
root.workflowCompleteDialog.panel
```

这些 slot 用于低定制主题配置图片边框、背景或装饰层。主题只需要在 `appearance.surfaces` 中配置对应 slot，不需要编写 React 组件。

## Dialog / Drawer 规则

Dialog 和 Drawer 的定位由基础组件负责。主题化 view 不能在根层覆盖基础组件的定位能力。

必须遵守：

- `DialogContent` / `DrawerContent` 根层不要添加 `relative` 覆盖已有 `fixed`。
- 根层允许装饰外溢，使用 `overflow-visible`。
- `ThemeSurface` 放在根层直接子级，作为 decoration layer。
- 滚动和裁剪放进内部 content layer，例如 `relative z-10 max-h-[90vh] overflow-y-auto rounded-[inherit]`。
- content layer 不要设置不透明背景，否则会遮挡 decoration layer。
- 如果基础组件自带 `bg-popover`，它属于 root 的基础背景，不要再在 content 上补不透明背景。

推荐结构：

```tsx
<DialogContent className="overflow-visible p-0">
  <ThemeSurface slot="root.someDialog.panel" />
  <div className="relative z-10 max-h-[90vh] overflow-y-auto rounded-[inherit]">
    <Header />
    <Body />
    <Footer />
  </div>
</DialogContent>
```

Drawer 同理：

```tsx
<DrawerContent className="overflow-visible">
  <ThemeSurface slot="root.someDrawer.panel" />
  <div className="relative z-10 min-h-0 flex-1 overflow-y-auto rounded-[inherit]">
    <Header />
    <Body />
    <Footer />
  </div>
</DrawerContent>
```

避免：

```tsx
<DialogContent className="relative overflow-hidden">
```

这个写法有两个问题：

- `relative` 会覆盖基础 Dialog 的 `fixed` 定位，导致浮层不再正常居中。
- `overflow-hidden` 会裁掉外扩图片边框。

## 自定义 Motion Overlay

不使用基础 Dialog / Drawer 的自定义浮层也要遵守同一分层：

```txt
motion root: fixed / size / base background / border / overflow-visible
ThemeSurface: absolute decoration
content: relative z-10，内部需要时再 overflow-hidden / overflow-auto
```

登录弹窗、确认弹窗、更新提示和文件预览面板属于这一类。

## 验收清单

新增或改造 root overlay view 时至少确认：

- 没有把 `relative` 加到会覆盖基础 `fixed` 定位的 Dialog / Drawer 根层。
- 图片边框可以外溢，不被根层裁剪。
- 滚动条只出现在真实内容区，不包含标题栏或 footer。
- `ThemeSurface` 不接收 pointer events。
- content 层在 decoration 层之上。
- content 层没有不透明背景遮挡装饰。
- 用户可见文案走 i18n。
- `ThemeComponentRegistry` 和 `ThemeSurfaceRegistry` 都登记了新增 id。
- 未配置主题时默认 UI 行为不变。
