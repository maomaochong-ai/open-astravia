import type { NewSessionHeroIdentity } from "@vetta/theme-ui";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAgentTeamDirectoryDocument } from "./agent-team-directory";
import { resolveNewSessionTargetIdentity } from "./new-session-target-identity";
import type { NewSessionTargetKey } from "./target";

/**
 * 选中的会话对象在 hero 上的身份（名称、描述、头像组）。
 *
 * 名录加载失败这里不报错：同屏的选择器已经有重试入口，hero 静默留在问候语，
 * 不要为同一次失败弹两处提示。
 */
export function useNewSessionTargetIdentity(targetKey: NewSessionTargetKey | null): NewSessionHeroIdentity | null {
	const { t } = useTranslation("chat");
	const document = useAgentTeamDirectoryDocument();

	return useMemo(
		() =>
			resolveNewSessionTargetIdentity(document, targetKey, {
				memberCount: (count) => t("newSession.agentSelector.memberCount", { count }),
			}),
		[document, t, targetKey],
	);
}
