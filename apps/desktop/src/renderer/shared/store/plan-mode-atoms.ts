import type { CodingAgentPlanReviewRequest } from "@vetta/coding-agent/function-extensions";
import type { CodingAgentPlanModeState } from "@vetta/coding-agent/session-extensions";
import { atom } from "jotai";

/**
 * 各会话的计划模式状态，按 runtimeId 索引。真相源在会话 Runtime（随会话文档持久化），
 * 这里只是 Coding Agent Plan Mode observation 的投影；没有记录即视为未开启。
 */
export const planModeStateBySessionAtom = atom<Record<string, CodingAgentPlanModeState>>({});

/**
 * 新会话页还没有 Runtime 可以承接模式切换，先把用户的选择记成草稿，
 * 会话创建后、发出第一条消息之前再落到 Runtime。
 */
export const draftPlanModeAtom = atom(false);

/** 等待用户审批的计划，按发起会话的 runtimeId 索引；输入栏据此被审批面板接管。 */
export const pendingPlanReviewsAtom = atom<Record<string, CodingAgentPlanReviewRequest>>({});
