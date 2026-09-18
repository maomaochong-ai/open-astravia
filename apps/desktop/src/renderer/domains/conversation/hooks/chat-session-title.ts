import {
	activeSessionAtom,
	defaultConversationCwdAtom,
	getProjectDisplayName,
	sessionDisplayLabel,
	sessionsMapAtom,
} from "@shared/store/atoms";
import { atom } from "jotai";
import { selectAtom } from "jotai/utils";

const activeSessionPathAtom = selectAtom(activeSessionAtom, (session) => session?.sessionPath ?? null);
const activeSessionCwdAtom = selectAtom(activeSessionAtom, (session) => session?.cwd ?? null);

/**
 * 对话页身份标题：会话展示名，否则项目名。ChatPage 未挂上时壳也读同一份 atom，
 * 主区首帧就能画出标题，不必等对话 chunk。
 */
export const chatSessionTitleAtom = atom((get) => {
	const path = get(activeSessionPathAtom);
	const cwd = get(activeSessionCwdAtom);
	const defaultCwd = get(defaultConversationCwdAtom);
	if (path === null && cwd === null) return null;
	const sessionsMap = get(sessionsMapAtom);
	for (const list of sessionsMap.values()) {
		const found = list.find((session) => session.path === path);
		if (found) return sessionDisplayLabel(found);
	}
	return getProjectDisplayName(cwd ?? "", defaultCwd);
});
