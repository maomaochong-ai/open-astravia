import type { CodingAgentGoalState } from "@vetta/coding-agent/session-extensions";
import { atom } from "jotai";

/** Runtime 目标状态的 Renderer 投影；不存在的 key 表示该会话没有目标。 */
export const goalStateBySessionAtom = atom<Record<string, CodingAgentGoalState>>({});
