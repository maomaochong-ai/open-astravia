import type { UpdaterState } from "@preload/api";
import { atom } from "jotai";

/**
 * 主进程 UpdaterService 的镜像状态。
 * 由 App.tsx 在挂载时通过 window.astravia.updater.onStateChanged 订阅写入。
 */
export const updaterStateAtom = atom<UpdaterState>({
	phase: "idle",
	currentVersion: "",
});

/**
 * 控制「版本介绍」对话框（当前运行版本的发布说明，随安装包带上）。
 * 与 updaterRestartDialogOpenAtom 共用同一个对话框视图，两者任一为 true 即打开。
 */
export const updaterCurrentNotesDialogOpenAtom = atom<boolean>(false);

/**
 * 控制"立即重启 / 稍后"确认对话框。
 * - phase === "ready" && !dismissed → 自动弹出（renderer 层用 effect 同步）
 * - 用户点"稍后"：关闭 Dialog，sidebar icon 退到"待重启"提示状态
 * - 用户重新点 sidebar icon："dismissed=false"，Dialog 再弹
 */
export const updaterRestartDialogOpenAtom = atom<boolean>(false);
