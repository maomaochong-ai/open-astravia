import type { UpdaterState } from "@preload/api";
import { atom } from "jotai";

/**
 * 主进程 UpdaterService 的镜像状态。
 * 由 App.tsx 在挂载时通过 window.vetta.updater.onStateChanged 订阅写入。
 */
export const updaterStateAtom = atom<UpdaterState>({
	phase: "idle",
	currentVersion: "",
});

/**
 * 控制"立即重启 / 稍后"确认对话框。
 * - phase === "ready" && !dismissed → 自动弹出（renderer 层用 effect 同步）
 * - 用户点"稍后"：关闭 Dialog，sidebar icon 退到"待重启"提示状态
 * - 用户重新点 sidebar icon："dismissed=false"，Dialog 再弹
 */
export const updaterRestartDialogOpenAtom = atom<boolean>(false);
