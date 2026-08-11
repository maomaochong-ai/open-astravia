import { type PluginCardProps, useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useMemo, useState } from "react";
import { designSystemById, useDesignSystems } from "../design-systems/index";
import { parsePreviewTokens } from "../design-systems/preview-tokens";
import { getPluginCtx, notify } from "../plugin-context";
import type { DesignSystemCardPayload } from "./design-system-card";
import { DesignSystemTileContent } from "./DesignSystemTileContent";
import { TemplateGalleryDialog } from "./TemplateGalleryDialog";

/** 名称右侧的「已选择 / 已排队」徽标。 */
function PickedBadge({ label }: { label: string }) {
	return (
		<span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
			{label}
		</span>
	);
}

/**
 * 选择状态按 descriptor.key 记在模块级：消息列表虚拟滚动会反复卸载/重挂载卡片，
 * 纯组件 state 会复位、让同一张卡被重复点击重复发 prompt（ADR-0060）。
 */
interface CardSendState {
	choiceId: string;
	phase: "sending" | "queued" | "sent";
	queueItemId?: string;
}
const cardSendStateByKey = new Map<string, CardSendState>();
/** descriptor.key 理论上总是存在（present 每次生成新 key）；兜底键只求不崩。 */
const DESIGN_SYSTEM_CARD_FALLBACK_KEY = "vetd-design-system-card";

/**
 * 会话里的设计体系选择卡（vetd_design_systems 的 present 用法渲染）：响应式
 * 宫格，第一格是「不使用设计系统」出口，中间为候选体系，末格「更多」打开
 * 全局模板 Dialog。宫格点击即把选择回灌给 agent（由它调 apply 用法执行）；
 * Dialog 里则要点「应用」才发送。选择协议串跟宿主语言走，与 ask-vetta 同一取舍。
 */
export function DesignSystemPickerCard({ descriptor }: PluginCardProps) {
	const { t } = useTranslation();
	// 远端清单到货后这里会重渲染，「更多」格的数量与色点跟着更新。
	const allSystems = useDesignSystems();
	const payload = (descriptor.payload ?? {}) as Partial<DesignSystemCardPayload>;
	const systems = (payload.systems ?? []).map(designSystemById).filter((system) => system !== undefined);
	/** 已点过的选择（含 skip）。这张卡是一次性问句：选完就锁住，避免重复触发。 */
	const stateKey = descriptor.key ?? DESIGN_SYSTEM_CARD_FALLBACK_KEY;
	const [sendState, setSendStateLocal] = useState<CardSendState | null>(cardSendStateByKey.get(stateKey) ?? null);
	const setSendState = (next: CardSendState | null): void => {
		if (next) cardSendStateByKey.set(stateKey, next);
		else cardSendStateByKey.delete(stateKey);
		setSendStateLocal(next);
	};
	const chosen = sendState?.choiceId ?? null;
	const [galleryOpen, setGalleryOpen] = useState(false);

	// streaming 中点击时 prompt 进入会话队列（ADR-0060）：徽标显示「已排队」而非假装
	// 「已选择」；条目被消费（队列里消失）后翻成已选择。
	useEffect(() => {
		if (sendState?.phase !== "queued" || !sendState.queueItemId) return;
		const itemId = sendState.queueItemId;
		const sub = getPluginCtx().conversation.on((event) => {
			if (event.type !== "queue-changed") return;
			if (event.queue.items.some((item) => item.id === itemId)) return;
			setSendState({ ...sendState, phase: "sent" });
		});
		return () => sub.dispose();
		// setSendState 为渲染期闭包，依赖 sendState 即可。
	}, [sendState]);

	/** 「更多」格的九宫色点：取未展示体系的主色，预告 Dialog 里还有什么。 */
	const moreSwatches = useMemo(() => {
		const shown = new Set(systems.map((system) => system.id));
		return allSystems.filter((system) => !shown.has(system.id))
			.slice(0, 9)
			.map((system) => ({ id: system.id, color: parsePreviewTokens(system.themeCss).colors.primary }));
	}, [systems, allSystems]);

	const send = (choiceId: string, prompt: string): void => {
		if (chosen) return;
		setSendState({ choiceId, phase: "sending" });
		void getPluginCtx()
			.conversation.sendPrompt(prompt)
			.then((result) => {
				if (result?.status === "queued") {
					setSendState({ choiceId, phase: "queued", queueItemId: result.queueItemId });
				} else {
					setSendState({ choiceId, phase: "sent" });
				}
			})
			.catch((error: unknown) => {
				notify({ message: t("ds.card.sendFailed"), error });
				setSendState(null);
			});
	};

	const choose = (systemId: string, name: string): void => {
		const zh = getPluginCtx().i18n.locale.toLowerCase().startsWith("zh");
		send(
			systemId,
			zh
				? `我选择「${name}」设计体系（${systemId}），请应用到当前设计稿。`
				: `I choose the "${name}" design system (${systemId}) — please apply it to the current design.`,
		);
	};

	const skip = (): void => {
		const zh = getPluginCtx().i18n.locale.toLowerCase().startsWith("zh");
		send(
			"__skip__",
			zh
				? "不使用设计体系模板，按你自己的判断设计即可。"
				: "Don't use a design-system template — proceed with your own design judgment.",
		);
	};

	if (systems.length === 0) return null;

	const locked = chosen !== null;
	/** 排队中用「已排队」徽标提示真实状态；发出（或消费）后回到「已选择」。 */
	const pickedLabel = sendState?.phase === "queued" ? t("ds.card.queued") : t("ds.card.picked");
	/** Dialog 里选的体系不在宫格里时，「更多」格代为展示选中态。 */
	const chosenViaGallery =
		chosen !== null && chosen !== "__skip__" && !systems.some((system) => system.id === chosen)
			? designSystemById(chosen)
			: undefined;

	/** 内容格（skip/更多）的状态样式；体系格的选中态在下面单独拼。 */
	const plainTileClass = (picked: boolean): string =>
		picked
			? "border-primary bg-primary/5 ring-1 ring-primary"
			: locked
				? "border-border opacity-40"
				: "border-border enabled:hover:-translate-y-0.5 enabled:hover:border-muted-foreground/50 enabled:hover:bg-accent/40 enabled:hover:shadow-md";

	return (
		<div className="py-1">
			<div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
				{payload.allowSkip !== false ? (
					<button
						type="button"
						disabled={locked}
						onClick={skip}
						className={`flex aspect-square min-w-0 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border border-dashed p-3 text-center transition-all duration-200 ${plainTileClass(chosen === "__skip__")}`}
					>
						<span className="flex size-9 items-center justify-center rounded-full bg-accent text-muted-foreground">
							<svg viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
								<path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
								<path d="M18.5 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z" />
							</svg>
						</span>
						<span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
							{t("ds.card.skip")}
							{chosen === "__skip__" ? <PickedBadge label={pickedLabel} /> : null}
						</span>
						<span className="text-[11px] leading-tight text-muted-foreground">{t("ds.card.skipHint")}</span>
					</button>
				) : null}
				{systems.map((system) => {
					const picked = chosen === system.id;
					return (
						<button
							key={system.id}
							type="button"
							disabled={locked}
							onClick={() => choose(system.id, system.name)}
							className={`flex aspect-square min-w-0 flex-col gap-1.5 overflow-hidden rounded-xl border p-2 text-left transition-all duration-200 ${
								picked
									? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary"
									: locked
										? "border-border opacity-40"
										: "border-border enabled:hover:-translate-y-0.5 enabled:hover:border-muted-foreground/40 enabled:hover:bg-accent/40 enabled:hover:shadow-md"
							}`}
						>
							<DesignSystemTileContent
								system={system}
								badge={picked ? <PickedBadge label={pickedLabel} /> : undefined}
							/>
						</button>
					);
				})}
				<button
					type="button"
					disabled={locked}
					onClick={() => setGalleryOpen(true)}
					className={`flex aspect-square min-w-0 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border border-dashed p-3 text-center transition-all duration-200 ${plainTileClass(chosenViaGallery !== undefined)}`}
				>
					<span className="grid grid-cols-3 gap-1">
						{moreSwatches.map((swatch) => (
							<span
								key={swatch.id}
								className="size-2 rounded-full ring-1 ring-black/10"
								style={{ background: swatch.color }}
							/>
						))}
					</span>
					<span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
						{chosenViaGallery ? chosenViaGallery.name : t("ds.card.more")}
						{chosenViaGallery ? <PickedBadge label={pickedLabel} /> : null}
					</span>
					<span className="text-[11px] leading-tight text-muted-foreground">
						{t("ds.card.moreHint", { count: allSystems.length })}
					</span>
				</button>
			</div>
			{galleryOpen ? (
				<TemplateGalleryDialog
					onClose={() => setGalleryOpen(false)}
					onApply={(systemId, name) => {
						setGalleryOpen(false);
						choose(systemId, name);
					}}
				/>
			) : null}
		</div>
	);
}
