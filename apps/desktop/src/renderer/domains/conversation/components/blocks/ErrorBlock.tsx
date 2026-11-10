import { ErrorBlockView as ThemeErrorBlockView } from "@astravia-org/theme-ui/chat/MessageBlockSegmentsView";
import type { ErrorBlock } from "@shared/store/atoms";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useOptionalConversationCapability, useOptionalConversationStreaming } from "../../conversation-view/feed";
import type { ChatErrorKind } from "../../services/classifyChatError";
import { useExpansion } from "../message-list/expansionStore";

/** 每类错误的图标。中性表意，不用红色警报。 */
const ICON_BY_KIND: Record<ChatErrorKind, string> = {
	rate_limit: "icon-[mdi--timer-sand]",
	quota: "icon-[mdi--battery-alert-variant-outline]",
	network: "icon-[mdi--wifi-off]",
	auth: "icon-[mdi--key-outline]",
	server: "icon-[mdi--server-network-off]",
	truncated: "icon-[mdi--content-cut]",
	unknown: "icon-[mdi--alert-circle-outline]",
};

/**
 * 需要人去改配置的两类，各自的设置页落点与按钮文案。
 *
 * 其余暂时性状况不给按钮：限流等一会儿就好，服务端错误重发即可，而「去设置」会
 * 制造「我该做点什么」的错觉。断网是唯一的例外——它有明确的下一步，见下方
 * resumeAction。
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
	const resume = useOptionalConversationCapability("resumeInterruptedTurn");
	const streaming = useOptionalConversationStreaming();
	const settingsAction =
		kind === "quota" || kind === "auth"
			? {
					label: t(ACTION_BY_KIND[kind].labelKey),
					onClick: () => void navigate({ to: "/settings/$tab", params: { tab: ACTION_BY_KIND[kind].tab } }),
				}
			: undefined;
	// 断网把回合停在半路时，网络回来后再起一个回合接着写，而不是让用户自己琢磨着
	// 再发一句「继续」。已经在生成就不重复给入口（快照、只读与 Team 场景没有这个能力）。
	const resumeAction =
		kind === "network" && resume && !streaming
			? { label: t("messageList.errorBlock.kinds.network.action"), onClick: resume }
			: undefined;
	const action = settingsAction ?? resumeAction;
	// 「已自动重试 N 次」（live）与「重复出现 N 次」（历史回放）互斥：前者是本次
	// 请求内部的重试，后者是会话文件里连续同类错误折叠后的条数。
	const note = block.attempts
		? t("messageList.errorBlock.retriedNote", { count: block.attempts })
		: block.repeated && block.repeated > 1
			? t("messageList.errorBlock.repeatedNote", { count: block.repeated })
			: undefined;
	const diagnosticLines = [
		block.details?.code ? t("messageList.errorBlock.diagnostic.code", { value: block.details.code }) : undefined,
		block.details?.origin ? t("messageList.errorBlock.diagnostic.origin", { value: block.details.origin }) : undefined,
		block.details?.statusCode !== undefined
			? t("messageList.errorBlock.diagnostic.statusCode", { value: block.details.statusCode })
			: undefined,
		block.details?.provider ? t("messageList.errorBlock.diagnostic.provider", { value: block.details.provider }) : undefined,
		block.details?.modelId ? t("messageList.errorBlock.diagnostic.model", { value: block.details.modelId }) : undefined,
		block.details?.providerCode
			? t("messageList.errorBlock.diagnostic.providerCode", { value: block.details.providerCode })
			: undefined,
		block.details?.phase ? t("messageList.errorBlock.diagnostic.phase", { value: block.details.phase }) : undefined,
		block.details?.requestId ? t("messageList.errorBlock.diagnostic.requestId", { value: block.details.requestId }) : undefined,
		block.details?.retryAfterMs !== undefined
			? t("messageList.errorBlock.diagnostic.retryAfter", { value: block.details.retryAfterMs })
			: undefined,
	].filter((line): line is string => Boolean(line));

	return (
		<ThemeErrorBlockView
			iconClass={ICON_BY_KIND[kind]}
			detail={block.text}
			diagnostics={diagnosticLines.length > 0 ? diagnosticLines.join("\n") : undefined}
			expanded={expanded}
			onToggleExpanded={toggleExpanded}
			exportMode={exportMode}
			action={!exportMode && action ? action : undefined}
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
