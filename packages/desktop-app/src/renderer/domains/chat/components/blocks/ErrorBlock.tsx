import type { ErrorBlock } from "@shared/store/atoms";
import { ErrorBlockView as ThemeErrorBlockView } from "@vetta/theme-ui/chat";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { ChatErrorKind } from "../../services/classifyChatError";
import { useExpansion } from "../message-list/expansionStore";

/** 每类错误的图标。中性表意，不用红色警报。 */
const ICON_BY_KIND: Record<ChatErrorKind, string> = {
	rate_limit: "icon-[mdi--timer-sand]",
	quota: "icon-[mdi--battery-alert-variant-outline]",
	network: "icon-[mdi--wifi-off]",
	auth: "icon-[mdi--key-outline]",
	server: "icon-[mdi--server-network-off]",
	unknown: "icon-[mdi--alert-circle-outline]",
};

/**
 * 需要人工介入的两类各自的设置页落点与按钮文案。其余四类是暂时性状况，给按钮
 * 反而制造「我该做点什么」的错觉。
 */
const ACTION_BY_KIND = {
	quota: { tab: "account", labelKey: "messageList.errorBlock.kinds.quota.action" },
	auth: { tab: "models", labelKey: "messageList.errorBlock.kinds.auth.action" },
} as const satisfies Partial<Record<ChatErrorKind, { tab: string; labelKey: string }>>;

interface ErrorBlockProps {
	block: ErrorBlock;
	exportMode?: boolean;
}

export function ErrorBlockView({ block, exportMode = false }: ErrorBlockProps): JSX.Element {
	const { t } = useTranslation("chat");
	const navigate = useNavigate();
	const [expanded, toggleExpanded] = useExpansion(`error-detail:${block.id}`);

	const kind = block.kind;
	const action = kind === "quota" || kind === "auth" ? ACTION_BY_KIND[kind] : undefined;
	// 「已自动重试 N 次」（live）与「重复出现 N 次」（历史回放）互斥：前者是本次
	// 请求内部的重试，后者是会话文件里连续同类错误折叠后的条数。
	const note = block.attempts
		? t("messageList.errorBlock.retriedNote", { count: block.attempts })
		: block.repeated && block.repeated > 1
			? t("messageList.errorBlock.repeatedNote", { count: block.repeated })
			: undefined;

	return (
		<ThemeErrorBlockView
			iconClass={ICON_BY_KIND[kind]}
			detail={block.text}
			expanded={expanded}
			onToggleExpanded={toggleExpanded}
			exportMode={exportMode}
			action={
				!exportMode && action
					? {
							label: t(action.labelKey),
							onClick: () => void navigate({ to: "/settings/$tab", params: { tab: action.tab } }),
						}
					: undefined
			}
			labels={{
				title: t(`messageList.errorBlock.kinds.${kind}.title`),
				hint: t(`messageList.errorBlock.kinds.${kind}.hint`),
				note,
				showDetail: t("messageList.errorBlock.showDetail"),
				hideDetail: t("messageList.errorBlock.hideDetail"),
				copy: t("messageList.copyButton.copy"),
				copied: t("messageList.copyButton.copied"),
			}}
		/>
	);
}
