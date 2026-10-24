/**
 * 插件活动面板标签卡的「上栏记录」（cwd → 条目表，见 ADR-0026）。
 *
 * 编码与写入语义在 `@shared/lib/tab-visibility`：内置 tab 也从同一张表里读「用户显式添加
 * 过」，所以实现不能只服务插件。这里保留插件 SDK 侧的旧导出名。
 */
export { explicitTabVisibility, withTabVisibility as withPluginTabVisibility } from "@shared/lib/tab-visibility";
