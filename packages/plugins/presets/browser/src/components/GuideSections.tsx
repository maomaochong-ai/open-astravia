import { useTranslation } from "@vetta-org/plugin-sdk";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";

/**
 * 使用说明区：这个工作区视图的主体。
 *
 * 它回答的是「我为什么要用它、怎么开口」——插件本身没有可操作的界面，真正的入口是对话框。
 * 所以这里不做假的控件，只做能直接抄走的示例和一眼能读完的能力说明。
 */

interface Capability {
	key: string;
	titleKey: string;
	bodyKey: string;
}

const CAPABILITIES: readonly Capability[] = [
	{ key: "navigate", titleKey: "guide.cap.navigate.title", bodyKey: "guide.cap.navigate.body" },
	{ key: "interact", titleKey: "guide.cap.interact.title", bodyKey: "guide.cap.interact.body" },
	{ key: "signin", titleKey: "guide.cap.signin.title", bodyKey: "guide.cap.signin.body" },
	{ key: "isolation", titleKey: "guide.cap.isolation.title", bodyKey: "guide.cap.isolation.body" },
];

export function CapabilitiesSection(): JSX.Element {
	const { t } = useTranslation();
	return (
		<section className="flex flex-col gap-2.5">
			<span className="browser-section-label">{t("guide.capabilities.label")}</span>
			<div className="browser-grid">
				{CAPABILITIES.map((capability) => (
					<article key={capability.key} className="browser-card flex flex-col gap-1.5 p-4">
						<h3 className="text-sm font-medium">{t(capability.titleKey)}</h3>
						<p className="text-xs leading-relaxed text-muted-foreground">{t(capability.bodyKey)}</p>
					</article>
				))}
			</div>
		</section>
	);
}

export function ComparisonSection(): JSX.Element {
	const { t } = useTranslation();
	return (
		<section className="flex flex-col gap-2.5">
			<span className="browser-section-label">{t("guide.vs.label")}</span>
			<p className="text-sm leading-relaxed text-muted-foreground">{t("guide.vs.body")}</p>
		</section>
	);
}

const PROMPT_KEYS = ["guide.prompt.read", "guide.prompt.signin", "guide.prompt.form", "guide.prompt.compare"] as const;

/** 复制成功的提示保留 1.6s；用 ref 存 timer 以便卸载时清掉，避免对已卸载组件 setState。 */
const COPIED_FEEDBACK_MS = 1_600;

export function PromptsSection(): JSX.Element {
	const { t } = useTranslation();
	const [copiedKey, setCopiedKey] = useState<string | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (timer.current !== null) clearTimeout(timer.current);
		};
	}, []);

	const copy = useCallback((key: string, text: string) => {
		// 剪贴板可能因权限或非安全上下文失败；复制不了就静默保持原状，
		// 用户还可以手动选中文本，没必要为此弹一个错误。
		void navigator.clipboard?.writeText(text).then(
			() => {
				setCopiedKey(key);
				if (timer.current !== null) clearTimeout(timer.current);
				timer.current = setTimeout(() => setCopiedKey(null), COPIED_FEEDBACK_MS);
			},
			() => undefined,
		);
	}, []);

	return (
		<section className="flex flex-col gap-2.5">
			<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<span className="browser-section-label">{t("guide.prompts.label")}</span>
				<span className="text-xs text-muted-foreground">{t("guide.prompts.hint")}</span>
			</div>
			<div className="flex flex-col gap-2">
				{PROMPT_KEYS.map((key) => {
					const text = t(key);
					return (
						<button key={key} type="button" className="browser-prompt" onClick={() => copy(key, text)}>
							<span className="min-w-0 flex-1 text-sm">{text}</span>
							<span className="browser-prompt-action">
								{copiedKey === key ? t("guide.copied") : t("guide.copy")}
							</span>
						</button>
					);
				})}
			</div>
		</section>
	);
}

const CLI_KEYS = [
	"guide.cli.direct",
	"guide.cli.independent",
	"guide.cli.accounts",
	"guide.cli.upstream",
] as const;

export function CliSection(): JSX.Element {
	const { t } = useTranslation();
	return (
		<section className="flex flex-col gap-2.5">
			<span className="browser-section-label">{t("guide.cli.label")}</span>
			<div className="browser-card flex flex-col gap-2.5 p-4">
				<ul className="flex flex-col gap-2">
					{CLI_KEYS.map((key) => (
						<li key={key} className="flex items-start gap-2.5 text-xs leading-relaxed">
							<span
								className="browser-dot mt-1.5"
								style={{ background: "color-mix(in oklab, var(--primary) 70%, transparent)" }}
								aria-hidden="true"
							/>
							<span className="min-w-0 flex-1">{t(key)}</span>
						</li>
					))}
				</ul>
				<p className="text-xs text-muted-foreground">{t("guide.cli.hint")}</p>
			</div>
		</section>
	);
}
