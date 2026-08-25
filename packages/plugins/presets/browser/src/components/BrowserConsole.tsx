import { useTranslation } from "@vetta-org/plugin-sdk";
import { type JSX, useEffect, useState } from "react";
import type { BrowserRuntimeController, RuntimeStatus } from "../runtime/runtime-controller";
import { CapabilitiesSection, ComparisonSection, PromptsSection, SafetySection } from "./GuideSections";
import { RuntimeSection } from "./RuntimeSection";

/** 上游项目：命令面、浏览器控制与安全开关都来自这里，页面上必须把出处写清楚。 */
export const UPSTREAM_REPO_URL = "https://github.com/vercel-labs/agent-browser";

/**
 * 插件图标走宿主的 `vetta-plugin://` 协议，而**不是** `import icon from "../../icon.png"`。
 *
 * 打包资源的内联（assetsInlineLimit）只在 build 时生效，dev 链接下 Vite 会把它变成一个
 * 路径 URL；而插件 remote 跑在宿主页面里，该 URL 会按宿主 origin 解析而不是插件自己的
 * dev server，结果就是开发态图标 404 空白。协议地址由主进程解析（dev 链接指向源码目录、
 * 打包后指向安装目录），两种形态都成立。
 */
export const PLUGIN_ICON_URL = "vetta-plugin://browser/icon.png";

/**
 * 面板需要的副作用出口。全部走 props 注入，组件本身不 import ctx——
 * 这样整页可以在 jsdom 里用窄 fake 测出来，不必挂真实宿主。
 */
export interface BrowserConsolePorts {
	runtime: BrowserRuntimeController;
	/** 用系统默认浏览器打开外链（宿主 `ctx.ui.openExternal`）。 */
	openExternal: (url: string) => void;
}

function Hero({ onOpenRepo }: { onOpenRepo: () => void }): JSX.Element {
	const { t } = useTranslation();
	return (
		<header className="flex flex-col gap-4">
			<div className="flex items-start gap-4">
				<span className="browser-icon-plate">
					<img src={PLUGIN_ICON_URL} alt="" className="size-10" />
				</span>
				<div className="flex min-w-0 flex-col gap-1.5 pt-1">
					<h1 className="text-xl font-semibold tracking-tight">{t("console.title")}</h1>
					<p className="text-sm leading-relaxed text-muted-foreground">{t("hero.tagline")}</p>
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
				<span>{t("hero.upstream")}</span>
				<span aria-hidden="true">·</span>
				<span>{t("hero.license")}</span>
				<span aria-hidden="true">·</span>
				<button type="button" className="browser-link" onClick={onOpenRepo}>
					{t("hero.openRepo")}
				</button>
			</div>
		</header>
	);
}

export function BrowserConsole({ ports }: { ports: BrowserConsolePorts }): JSX.Element {
	const { t } = useTranslation();
	const [status, setStatus] = useState<RuntimeStatus>(() => ports.runtime.current());

	useEffect(() => ports.runtime.subscribe(setStatus), [ports.runtime]);

	return (
		<div className="browser-page" data-testid="browser-console">
			<div className="browser-page-inner">
				<Hero onOpenRepo={() => ports.openExternal(UPSTREAM_REPO_URL)} />

				<RuntimeSection
					status={status}
					onInstallRuntime={() => void ports.runtime.installRuntime()}
					onInstallBrowser={() => void ports.runtime.installBrowser()}
					onRecheck={() => void ports.runtime.refresh()}
				/>

				<CapabilitiesSection />
				<PromptsSection />
				<ComparisonSection />
				<SafetySection />

				<footer className="flex flex-col gap-2 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
					<p>{t("guide.newSession")}</p>
					<p>
						{t("footer.credit")}{" "}
						<button type="button" className="browser-link" onClick={() => ports.openExternal(UPSTREAM_REPO_URL)}>
							{UPSTREAM_REPO_URL}
						</button>
					</p>
				</footer>
			</div>
		</div>
	);
}
