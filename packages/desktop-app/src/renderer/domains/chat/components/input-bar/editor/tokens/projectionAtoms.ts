import { inputValueAtom } from "@shared/store/atoms";
import { atom } from "jotai";
import { initialImagePaths } from "./imagePaths";

/**
 * 编辑器投影出的派生态。
 *
 * 这里的每一个 atom 都只在「值真的变了」时通知订阅者。输入框每敲一个字符
 * inputValueAtom 都会换一个新字符串，若 UI 直接订阅它，整条 InputBar
 * （含斜杠面板、@ 面板、编辑器本身）就会逐字符重渲染——渣机上肉眼可见的卡顿
 * 就来自这里。所以对外只暴露布尔值与「内容不变则保持同一引用」的数组。
 */

/** 有没有可发送的内容（去空白后非空）。布尔值，整段打字过程最多翻转一次。 */
export const inputBlankAtom = atom((get) => get(inputValueAtom).trim().length === 0);

/** 是否展示 placeholder 覆盖层：与原生 textarea 一致，任意字符（含空格）即隐藏。 */
export const inputPlaceholderVisibleAtom = atom((get) => get(inputValueAtom).length === 0);

/**
 * 文本流里按出现顺序去重后的图片路径，由 ValueBridgePlugin 写入。
 *
 * 刻意不从 inputValueAtom 派生：那样每敲一个字符都要把整段文本重跑一次正则，
 * 而 bridge 手上本来就有解析好的 segments。写入前经 stableImagePaths 去抖，
 * 内容未变时保持同一引用，「图 N」胶囊与上方缩略图行因此不会被逐字符唤醒。
 */
export const inputImagePathsAtom = atom<readonly string[]>(initialImagePaths());
