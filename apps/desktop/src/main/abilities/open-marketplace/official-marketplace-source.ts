/**
 * Vetta 官方能力市场坐标。
 *
 * 发行方可以用 `VETTA_OPEN_MARKETPLACE_REPOSITORY` 把内置来源替换成自己的 fork；
 * 未配置时客户端始终注册官方源。内置来源属于发行方，用户不可删除、不可停用。
 */

/** 内置来源的固定 id：缓存目录、升级对账和默认 IPC 参数都以它为准。 */
export const DEFAULT_MARKETPLACE_SOURCE_ID = "vetta-official";
export const OFFICIAL_MARKETPLACE_REPOSITORY = "https://github.com/openvetta/vetta-official-marketplace";
export const OFFICIAL_MARKETPLACE_NAME = "Vetta Official";
