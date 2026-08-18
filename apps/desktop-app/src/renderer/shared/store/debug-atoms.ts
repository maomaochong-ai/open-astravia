import { atom } from "jotai";

/** 调试模式全局开关（初始值从 localStorage 读取，App 启动时与 config 同步） */
export const debugModeAtom = atom<boolean>(localStorage.getItem("vetta-debug-mode") === "true");

/** 调试面板子选项卡 */
export const debugSubTabAtom = atom<"tool-calls" | "request-history">("tool-calls");

/** 工具调用搜索关键词 */
export const debugToolSearchAtom = atom<string>("");

/** 工具调用状态筛选 */
export const debugToolFilterAtom = atom<"all" | "success" | "error">("all");
