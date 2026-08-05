import { type PluginCardProps, useTranslation } from "@vetta-org/plugin-sdk";
import { useState } from "react";
import { DesignSystemPreview } from "../canvas/DesignSystemPreview";
import { designSystemById } from "../design-systems/index";
import { getPluginCtx, notify } from "../plugin-context";
import type { DesignSystemCardPayload } from "./design-system-card";

/**
 * 会话里的设计体系选择卡（vetd_design_systems 的 present 用法渲染）：候选体系
 * 横排预览，点击即把选择回灌给 agent（由它调 apply 用法执行）；可附带
 * 「不使用模板」出口。选择协议串跟宿主语言走，与 ask-vetta 同一取舍。
 */
export function DesignSystemPickerCard({ descriptor }: PluginCardProps) {
	const { t } = useTranslation();
	const payload = (descriptor.payload ?? {}) as Partial<DesignSystemCardPayload>;
	const systems = (payload.systems ?? []).map(designSystemById).filter((system) => system !== undefined);
	/** 已点过的选择（含 skip）。这张卡是一次性问句：选完就锁住，避免重复触发。 */
	const [chosen, setChosen] = useState<string | null>(null);

	const send = (choiceId: string, prompt: string): void => {
		if (chosen) return;
		setChosen(choiceId);
		void getPluginCtx()
			.conversation.sendPrompt(prompt)
			.catch((error: unknown) => {
				notify({ message: t("ds.card.sendFailed"), error });
				setChosen(null);
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

	return (
		<div className="flex flex-col gap-2 py-1">
			<div className="overflow-x-auto">
				<div className="flex items-stretch gap-2.5">
					{systems.map((system) => {
						const picked = chosen === system.id;
						const locked = chosen !== null && !picked;
						return (
							<button
								key={system.id}
								type="button"
								disabled={chosen !== null}
								onClick={() => choose(system.id, system.name)}
								className={`flex w-52 shrink-0 flex-col gap-1.5 rounded-xl border p-2 text-left transition-all ${
									picked
										? "border-primary ring-1 ring-primary"
										: locked
											? "border-border opacity-40"
											: "border-border hover:border-muted-foreground/40 hover:bg-accent/40"
								}`}
							>
								<DesignSystemPreview system={system} />
								<div className="flex min-w-0 items-center gap-1.5 px-0.5">
									<span className="truncate text-xs font-semibold text-foreground">{system.name}</span>
									{picked ? (
										<span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
											{t("ds.card.picked")}
										</span>
									) : null}
									<span className="flex-1" />
									<span className="shrink-0 rounded-full bg-accent px-1.5 py-px text-[10px] text-muted-foreground">
										{t(`ds.category.${system.category}`)}
									</span>
								</div>
								<div className="truncate px-0.5 text-[11px] leading-tight text-muted-foreground">
									{t(`ds.tagline.${system.id}`)}
								</div>
							</button>
						);
					})}
				</div>
			</div>
			{payload.allowSkip !== false ? (
				<div>
					<button
						type="button"
						disabled={chosen !== null}
						onClick={skip}
						className={`rounded-lg border border-border px-2.5 py-1 text-xs transition-colors ${
							chosen === "__skip__"
								? "border-primary text-primary"
								: "text-muted-foreground hover:bg-accent hover:text-foreground"
						} disabled:opacity-60`}
					>
						{t("ds.card.skip")}
					</button>
				</div>
			) : null}
		</div>
	);
}
