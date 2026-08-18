import { atom } from "jotai";

/**
 * 后台正在 streaming 的 session 集合（key 为 sessionPath）。
 * 由 main 进程通过 vetta:session:running-changed 事件 + 启动时 list-running snapshot 维护。
 * sidebar 用它给 session item 加 spin、给 project icon 叠加 pulse 点。
 */
export const runningSessionPathsAtom = atom<Set<string>>(new Set<string>());
