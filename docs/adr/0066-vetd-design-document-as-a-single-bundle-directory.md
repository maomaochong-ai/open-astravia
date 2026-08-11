# Vetta UI Design：一份设计就是一个 `x.vetd/` 目录包

设计文档的工作态从「`x.vetd` manifest 文件 + `x.vetd.d/` 旁挂源码目录」两个并列条目，改成**一个目录**：`x.vetd/`，manifest 降级成它里面的 `design.json`。分享包仍是单个 zip 文件，扩展名改为 `.vetdz`。

理由：一份设计在用户眼里是一件东西，在磁盘上却是两个条目。移动、复制、删除、`git mv`、发给同事，每一次都要成对操作，漏一个就得到半份设计——manifest 没有源码是一张空画布，源码没有 manifest 丢掉全部画布坐标。而这两个条目的绑定关系只是一条命名约定（`sidecarDirOf`），文件系统层面没有任何东西在维护它。

## Considered Options

- **A 目录包（选定）**：`x.vetd/` 是目录，manifest 是包内的 `design.json`。一个条目，一次操作；引擎的 `VETD_SRC` 直接指向它。Sketch、Xcode 的老套路，macOS 还可以通过 UTI 让 Finder 把它显示成单文件。
- **B 单文件容器（zip / sqlite）**：形态上最干净，但与 ADR-0053 的地基冲突——vite dev server 要的是磁盘上的真实文件树，agent 也要能用普通读写工具编辑 tsx。必须解包到临时目录再回写，立刻产生双份事实源。
- **C 只在宿主文件树里把两个条目折叠显示**：零迁移成本，但 Finder、git、终端里仍是两个，管理成本只是被藏起来。

## Consequences

- `design.json` 落在被监听的包内，于是插件**自己**的每一次 manifest 落盘（拖画框、平移视口）都会绕回目录监听回调，而宿主的变更事件只带被监听的目录路径、认不出是哪个文件变的。因此 `DesignSession` 的对外通知改为「内容真的变了才发」：reconcile 只在 frame 集合或声明变化时 emit，theme 按内容比对；画布的 mtime 重扫也把 `design.json` 计入生成物排除名单。否则拖一下画框就是一次全画布重截图。
- 工作态是目录、分享包是文件，不能再共用 `.vetd`：分享包改叫 `.vetdz`。读取端按内容嗅探，历史导出的 `-share.vetd` 仍可导入。
- 旧文档在被发现时就地自动迁移（`migrateLegacyDesign`，幂等、无丢内容窗口），用户不需要做任何事。迁移后路径字符串不变（`.../x.vetd`），已记住的选择、pending 打开路径全部继续有效。
- 宿主的 `matchesFileExplorerWhen` 原先规定「扩展名匹配永不命中目录」，现已放开：目录包是一份文档而不是一堆文件，插件要能像给文件那样给它挂图标和右键项。只要文件的匹配器显式写 `resourceType: "file"`。
- 工作态在文件树里是目录，没有文件预览钩子可挂；编程模式下「点开一份设计看看」改由右键「在设计画布中打开」承接。
- Tailwind 的 `@source` 会连 `design.json` 一起扫；manifest 里都是标题与路径字面量，最坏情况是多生成一两个本来就存在的工具类。
