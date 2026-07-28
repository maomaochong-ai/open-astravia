import { Button } from "@vetta/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveAbilityDetailContent } from "../../lib/ability-presentation";
import type { AbilitiesModel, AbilityItem } from "../../types";
import { AbilityDetailEnter } from "./AbilityDetailEnter";
import { AbilityDetailHeader } from "./AbilityDetailHeader";
import { AbilityMarkdownBody } from "./AbilityMarkdownBody";
import { AbilityMetaList } from "./AbilityMetaList";
import { AbilityShowcaseList } from "./AbilityShowcaseList";
import { BundleInstallDialog } from "./BundleInstallDialog";
import { BundleMembersSection } from "./BundleMembersSection";
import { BundleUninstallDialog } from "./BundleUninstallDialog";
import { McpAbilitySection } from "./McpAbilitySection";
import { PluginAbilitySection } from "./PluginAbilitySection";
import { PluginPermissionsDialog } from "./PluginPermissionsDialog";

/** 通用壳层 + markdown 正文 + showcases + type 专属区块。 */
export function AbilityDetailView({
	item,
	model,
	onBack,
}: {
	item: AbilityItem;
	model: AbilitiesModel;
	onBack: () => void;
}): JSX.Element {
	const { t, i18n } = useTranslation("abilities");
	// raw.detail.i18n[locale] 覆盖块的取值语言，与界面语言一致。
	const language = i18n.language;
	const [bundleDialogOpen, setBundleDialogOpen] = useState(false);
	const [bundleInstallDialogOpen, setBundleInstallDialogOpen] = useState(false);
	const [permissionsDialogOpen, setPermissionsDialogOpen] = useState(false);

	const detail = useMemo(
		() => resolveAbilityDetailContent(item.market?.detail, language),
		[item.market?.detail, language],
	);

	const handlePrimary = (): void => {
		if (!item.installed || item.needsUpdate) {
			if (item.type === "bundle") {
				setBundleInstallDialogOpen(true);
				return;
			}
			model.install(item);
			return;
		}
		if (item.type === "mcp" && item.setupRequired) {
			model.setup(item);
			return;
		}
		if (!item.enabled) model.toggle(item);
	};

	const handleSecondary = (kind: "disable" | "configure" | "remove"): void => {
		if (kind === "disable") {
			if (item.enabled) model.toggle(item);
			return;
		}
		if (kind === "configure" && item.type === "mcp") {
			if (item.canConfigure) model.configure(item);
			else if (item.usesOAuth) {
				if (item.authorized) model.revokeAuthorization(item);
				else model.setup(item);
			}
			return;
		}
		if (kind === "remove") {
			if (item.type === "bundle") {
				setBundleDialogOpen(true);
				return;
			}
			model.uninstall(item);
			onBack();
		}
	};

	// 主 CTA 右侧的次要入口：插件是权限配置，mcp 是凭证 / 配置编辑。
	const primaryAside = ((): JSX.Element | undefined => {
		if (item.type === "plugin" && item.permissions.length > 0) {
			return (
				<Button
					variant="secondary"
					size="lg"
					onClick={() => setPermissionsDialogOpen(true)}
				>
					<span className="icon-[solar--shield-keyhole-linear] h-4 w-4" />
					{t("plugin.permissionsDialog")}
				</Button>
			);
		}
		if (item.type === "mcp" && item.canConfigure) {
			return (
				<Button
					variant="secondary"
					size="lg"
					disabled={item.busy}
					onClick={() => model.configure(item)}
				>
					<span className="icon-[solar--key-minimalistic-square-linear] h-4 w-4" />
					{t("actions.configure")}
				</Button>
			);
		}
		if (item.type === "mcp" && item.canEdit) {
			return (
				<Button
					variant="secondary"
					size="lg"
					disabled={item.busy}
					onClick={() => model.edit(item)}
				>
					<span className="icon-[solar--pen-2-linear] h-4 w-4" />
					{t("actions.edit")}
				</Button>
			);
		}
		return undefined;
	})();

	// 滚动与内边距由外层容器（AbilityDetailSheet）负责，这里只排内容列。
	return (
		<div className="flex w-full flex-col gap-7">
			<AbilityDetailEnter index={0}>
				<AbilityDetailHeader
					item={item}
					onPrimary={handlePrimary}
					onSecondary={handleSecondary}
					primaryAside={primaryAside}
				/>
			</AbilityDetailEnter>

			{model.errors.length > 0 ? (
				<div className="rounded-lg bg-muted/60 px-3 py-2 text-[12px] text-muted-foreground/70">
					{t("error.partial", { error: model.errors.join(" / ") })}
				</div>
			) : null}

			{detail.showcases.length > 0 ? (
				<AbilityDetailEnter index={1}>
					<AbilityShowcaseList showcases={detail.showcases} />
				</AbilityDetailEnter>
			) : null}

			<AbilityDetailEnter index={2}>
				{detail.content ? (
					<AbilityMarkdownBody content={detail.content} />
				) : (
					<p className="text-[13px] leading-relaxed text-muted-foreground">{t("detail.noContent")}</p>
				)}
			</AbilityDetailEnter>

			{/* 页尾附属信息：与正文之间只用一条分隔线 */}
			<div className="mt-1 flex flex-col gap-6 border-t border-border/50 pt-6">
				<AbilityDetailEnter index={3}>
					{item.type === "plugin" ? <PluginAbilitySection item={item} model={model} /> : null}
					{item.type === "mcp" ? <McpAbilitySection item={item} model={model} /> : null}
					{item.type === "bundle" ? <BundleMembersSection item={item} model={model} /> : null}
				</AbilityDetailEnter>

				{/* 元信息表固定在页尾 */}
				<AbilityDetailEnter index={4}>
					<AbilityMetaList meta={detail.meta} />
				</AbilityDetailEnter>
			</div>

			{item.type === "plugin" && item.permissions.length > 0 ? (
				<PluginPermissionsDialog
					item={item}
					model={model}
					open={permissionsDialogOpen}
					onOpenChange={setPermissionsDialogOpen}
				/>
			) : null}

			{item.type === "bundle" ? (
				<BundleInstallDialog
					bundle={item}
					open={bundleInstallDialogOpen}
					onOpenChange={setBundleInstallDialogOpen}
					onConfirm={(members) => model.installBundleMembers(item, members)}
				/>
			) : null}

			{item.type === "bundle" ? (
				<BundleUninstallDialog
					bundle={item}
					open={bundleDialogOpen}
					onOpenChange={setBundleDialogOpen}
					onConfirm={(members) => model.uninstallBundleMembers(members)}
				/>
			) : null}
		</div>
	);
}
