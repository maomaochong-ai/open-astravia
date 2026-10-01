# Agent 支持 install-from-path，安装时按声明一次授权

对话/工作台要把 cwd 里打好的 zip **装进本机 Astravia**，但 `plugins.manage` 只有 `install-from-url`；GUI 虽有 `installFromArchive`，Agent 无稳定本地路径通道。用户插件装完后权限默认未授，白痴路径常卡在「装了不能用」。

决定：宿主 `plugins.manage` 增加 **`install-from-path`**（任意本机可读 zip 绝对路径，信任模型同 archive 安装，校验仍走既有 manifest/解压闸）；安装流程**按 `plugin.json` 声明弹出一次授权确认**后写入 `grantedPermissions`（及适用时的 commands），不静默全开，也不把「必须去设置页勾权限」当作主路径。

## Considered options

- **仅工作台封装 installFromArchive**：安装能力绑死工作台，违背「宿主通用、不特殊化」，否。
- **静默授予全部声明权限**：白痴最省事，削弱用户插件授权模型，否。
- **路径必须落在会话 cwd 内**：更严，但面板选包/脚本产出临时路径易卡，否。

## Consequences

- Action 与 GUI 共用同一 install 内核；工作台只做调用方。
- 系统插件仍不可被 install 覆盖（既有 id 保留规则）。
- `listPlugins` 等需能暴露插件 **rootPath**（供工作台脚本定位系统插件根）可作为配套 API，不改变本决策核心。
