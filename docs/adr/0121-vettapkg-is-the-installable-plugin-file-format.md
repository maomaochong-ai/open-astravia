# ADR-0121：`.vettapkg` 是可安装插件文件格式

- 状态：已接受
- 日期：2026-09-19

## 背景

Vetta 插件一直使用 ZIP 容器，但公开文件仍以 `.zip` 发布。操作系统无法把普通压缩包与
可安装插件区分开，用户双击后进入压缩软件，也无法由 Desktop 注册专属文件关联。市场、
插件构建工具、工作台和本地安装路径因此都把容器实现暴露成了产品格式。

## 决策

1. 可安装插件使用 `.vettapkg` 扩展名；容器继续使用 ZIP，包内 `plugin.json`、`dist/`
   和资源布局保持不变。MIME 类型为 `application/vnd.vetta.plugin+zip`。
2. `@vetta-org/plugin-vite`、插件工作台和市场发布流水线只生成新的扩展名。npm 分发信封的
   默认稳定路径改为 `release/vetta-plugin.vettapkg`。
3. Desktop 打包时向 Windows、macOS 和 Linux 注册文件关联。冷启动参数、Windows/Linux
   第二实例参数和 macOS `open-file` 事件进入同一个串行处理服务；服务在安装前解析并校验
   `plugin.json`，展示身份、权限与命令，只有用户确认后才安装、授权并启用。
4. 主动打开文件只识别 `.vettapkg`，避免 Vetta 声明普通 ZIP 的系统关联。本地路径安装和
   CLI 继续接受旧 `.zip` 插件包，作为存量制品迁移路径；安全校验和安装存储不分叉。
5. 市场制品仍按 ADR-0120 校验 HTTPS、大小、SHA-256、身份和声明。扩展名不参与信任判断，
   也不替代包内清单校验。

## 备选方案

- `.vetta-plugin`：语义清楚，但文件名较长；最终选择更紧凑且仍保留品牌辨识度的
  `.vettapkg`。
- `.vpkg`：已有 Amazon Vega、Vectorworks 等格式使用，系统文件关联存在冲突。
- 继续使用 `.zip`：无需迁移，但无法提供可靠的双击安装和类型辨识。
- 改用新的二进制容器：没有增加安全性，反而需要重写构建、解压与生态工具。

## 影响与验证

新工具生成的文件名发生变化，读取包内容的实现保持兼容。存量 npm 包按自身
`package.json#vetta.archive` 仍可安装；新发布包应改用 `.vettapkg` 路径。

合同测试覆盖构建产物名、CLI 工程解析、Desktop 路径兼容和打包文件关联；主进程流程测试
覆盖启动期排队、确认、取消、失败恢复与连续安装。正式安装包仍需由跨平台 packaged CI
验证操作系统文件关联。
