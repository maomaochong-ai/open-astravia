import type { ModelsConfigData } from "@preload/api";
import { atom } from "jotai";

/**
 * 模型目录的两份共享状态。
 *
 * 单独成模块（只依赖 jotai）是为了让不需要 IPC/浏览器环境的模块也能引用它们，
 * 不被 auth-atoms 那条带副作用的依赖链拖进来。写入方统一是 model-catalog。
 */

/** 本地 models.json 的共享快照，null 表示尚未加载。 */
export const localModelsConfigAtom = atom<ModelsConfigData | null>(null);

/** 服务端下发的远程 provider catalog（Vetta Go 等）。 */
export const remoteProvidersAtom = atom<Record<string, unknown>>({});
