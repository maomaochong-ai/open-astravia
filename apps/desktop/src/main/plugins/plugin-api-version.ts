/**
 * - 2.2.0：团队成员的角色槽位与跨插件引用（`agents[].roles`、`members[].role/optional`）。
 * - 2.3.0：团队成员的任务书（`members[].instructions` / `instructionsPath`）。
 * - 2.4.0：Media Provider v5 的模型目录与受控输入读取。
 * - 2.5.0：构建期绑定插件身份的持久化 logger。
 * - 2.6.0：活动面板标签卡自报默认排位（`registerActivityTab` 的 `order`）。
 * - 2.7.0：会话底部面板贡献点（`registerBottomPanel`）与 `ui.slot.bottom-panel` 权限。
 *
 * 清单校验对未知字段 fail-closed。作者把 `pluginApiVersion` 写成用到的那一档，
 * 旧宿主才能给出明确的版本错误。
 */
export const PLUGIN_API_VERSION = "2.7.0";
