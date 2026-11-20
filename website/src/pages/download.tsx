import { useEffect, useState } from "react";
import { resolveDownloadTarget, type DownloadTarget } from "../lib/download-target";
import { resolveMobileInstall, resolveMobilePlatform } from "../lib/mobile-install";
import { Icon } from "../app/ui";

export const DOWNLOAD_VERSION = "0.5.99";

const BASE = `https://dl.astravia.dev/app/v${DOWNLOAD_VERSION}`;

const OTHERS: { label: string; href: string; rec?: boolean }[] = [
	{ label: "macOS Apple Silicon · DMG", href: `${BASE}/Astravia-${DOWNLOAD_VERSION}-arm64.dmg`, rec: true },
	{ label: "macOS Apple Silicon · ZIP", href: `${BASE}/Astravia-${DOWNLOAD_VERSION}-arm64-mac.zip` },
	{ label: "macOS Intel · DMG", href: `${BASE}/Astravia-${DOWNLOAD_VERSION}.dmg` },
	{ label: "macOS Intel · ZIP", href: `${BASE}/Astravia-${DOWNLOAD_VERSION}-mac.zip` },
	{ label: "Windows x64 · Inno Setup", href: `${BASE}/Astravia-${DOWNLOAD_VERSION}-win-x64.exe`, rec: true },
	{ label: "Windows x64 · MSI", href: `${BASE}/Astravia-${DOWNLOAD_VERSION}-win-x64.msi` },
	{ label: "Windows x64 · ZIP", href: `${BASE}/Astravia-${DOWNLOAD_VERSION}-win-x64.zip` },
	{ label: "Linux x64 · AppImage", href: `${BASE}/Astravia-${DOWNLOAD_VERSION}.AppImage`, rec: true },
	{ label: "Linux x64 · DEB", href: `${BASE}/astravia_${DOWNLOAD_VERSION}_amd64.deb` },
	{ label: "Linux x64 · RPM", href: `${BASE}/astravia-${DOWNLOAD_VERSION}.x86_64.rpm` },
];

const PLATFORMS = [
	{
		name: "macOS",
		desc: "Apple 芯片与 Intel 各一份产物。",
		links: [
			["Apple Silicon · DMG", `${BASE}/Astravia-${DOWNLOAD_VERSION}-arm64.dmg`],
			["Apple Silicon · ZIP", `${BASE}/Astravia-${DOWNLOAD_VERSION}-arm64-mac.zip`],
			["Intel · DMG", `${BASE}/Astravia-${DOWNLOAD_VERSION}.dmg`],
			["Intel · ZIP", `${BASE}/Astravia-${DOWNLOAD_VERSION}-mac.zip`],
		],
	},
	{
		name: "Windows",
		desc: "EXE 走安装向导，MSI 适合分发，ZIP 免安装。",
		links: [
			["x64 · Inno Setup", `${BASE}/Astravia-${DOWNLOAD_VERSION}-win-x64.exe`],
			["x64 · MSI", `${BASE}/Astravia-${DOWNLOAD_VERSION}-win-x64.msi`],
			["x64 · ZIP", `${BASE}/Astravia-${DOWNLOAD_VERSION}-win-x64.zip`],
		],
	},
	{
		name: "Linux",
		desc: "AppImage 免安装；DEB / RPM 走发行版包管理。",
		links: [
			["x64 · AppImage", `${BASE}/Astravia-${DOWNLOAD_VERSION}.AppImage`],
			["x64 · DEB", `${BASE}/astravia_${DOWNLOAD_VERSION}_amd64.deb`],
			["x64 · RPM", `${BASE}/astravia-${DOWNLOAD_VERSION}.x86_64.rpm`],
		],
	},
];

type UserAgentData = { getHighEntropyValues?: (hints: readonly string[]) => Promise<{ architecture?: string }> };

function uaData(): UserAgentData | undefined {
	return (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
}

/** 按设备给出推荐产物；Chromium 能报真实架构，拿不到时先按 Apple 芯片落地。 */
function useDownloadTarget(): DownloadTarget {
	const userAgent = navigator.userAgent;
	const canReadArch = typeof uaData()?.getHighEntropyValues === "function";
	const [target, setTarget] = useState<DownloadTarget>(() =>
		resolveDownloadTarget({ userAgent }, { version: DOWNLOAD_VERSION, intelHint: !canReadArch }),
	);

	useEffect(() => {
		if (!canReadArch) return;
		let alive = true;
		uaData()
			?.getHighEntropyValues?.(["architecture"])
			.then((values) => {
				if (!alive) return;
				setTarget(resolveDownloadTarget({ userAgent, architectureHint: values?.architecture }, { version: DOWNLOAD_VERSION }));
			})
			.catch(() => undefined);
		return () => {
			alive = false;
		};
	}, [canReadArch, userAgent]);

	return target;
}

function Hero() {
	const target = useDownloadTarget();
	const [othersOpen, setOthersOpen] = useState(false);

	return (
		<section className="dl-hero">
			<div className="hero__grid" aria-hidden="true" />
			<div className="page-hero__glow" aria-hidden="true" />
			<div className="wrap dl-hero__inner">
				<h1 className="dl-hero__title reveal">下载</h1>
				<p className="dl-hero__sub reveal">我们会检测你的设备并推荐合适的版本。点击即可下载，或通过箭头选择其他平台。</p>

				<div className="dl-hero__cta reveal">
					<a className="dl-primary" id="dlPrimary" href={target.href} target="_blank" rel="noopener noreferrer">
						<span id="dlPrimaryText">{target.label}</span>
						<span className="dl-primary__switch" aria-hidden="true">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
								<path d="M3 8h13l-3-3" />
								<path d="M21 16H8l3 3" />
							</svg>
						</span>
					</a>
					<p className="dl__version" id="dlPrimaryVersion">
						{target.versionLabel}
					</p>

					<button
						className={othersOpen ? "dl__others-toggle is-open" : "dl__others-toggle"}
						id="dlOthersToggle"
						type="button"
						aria-expanded={othersOpen}
						onClick={() => setOthersOpen(!othersOpen)}
					>
						其他版本
						<Icon.Chevron className="ico-chevron" />
					</button>
					<div className={othersOpen ? "dl__others is-open" : "dl__others"} id="dlOthers">
						<ul className="dl__others-list">
							{OTHERS.map((item) => (
								<li key={item.label}>
									<a className="dl__others-item" href={item.href} target="_blank" rel="noopener noreferrer">
										<span>
											{item.label}
											{item.rec ? <span className="dl-rec">推荐</span> : null}
										</span>
									</a>
								</li>
							))}
						</ul>
					</div>
				</div>

				<ul className="dl-hero__providers reveal" aria-label="支持的模型服务商">
					{[
						["openai", "OpenAI"],
						["ollama", "Ollama"],
						["kimi", "Kimi"],
						["grok", "Grok"],
						["mistral", "Mistral"],
						["doubao", "豆包"],
						["minimax", "MiniMax"],
						["zai", "Z.ai"],
					].map(([file, alt]) => (
						<li key={alt}>
							<img src={`/download/${file}.webp`} width="26" height="26" alt={alt} loading="lazy" />
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}

function Mobile() {
	const platform = resolveMobilePlatform(navigator.userAgent);
	const ios = resolveMobileInstall("ios");
	const android = resolveMobileInstall(platform === "desktop" ? "desktop" : "android");

	return (
		<section className="band mob-band" id="dlMobile">
			<div className="wrap">
				<header className="section-head reveal">
					<p className="eyebrow">手机端</p>
					<h2 className="display display--sm">手机上接着用同一台电脑</h2>
					<p className="lede">
						手机与桌面端用同一套配对协议：桌面上点「手机扫码连接」，手机扫码后就能接着看会话、发指令。两端都免费。
					</p>
				</header>

				<div className="mob-grid">
					<article className={platform === "ios" ? "mob-card is-detected reveal" : "mob-card reveal"} data-mob="ios">
						<header className="mob-card__head">
							<h3 className="mob-card__title">iPhone / iPad</h3>
							<p className="mob-card__tag">未上架 App Store</p>
						</header>
						<p className="mob-card__desc">下载 IPA，用你自己的 Apple ID 签名安装。不需要开发者账号，也不必把设备交给别人。系统要求 iOS 26 或更高。</p>
						<div className="mob-card__cta">
							<a className="btn btn--ghost" id="mobIosHref" href={ios.href}>
								<Icon.Download />
								<span>{ios.label}</span>
							</a>
							<p className="mob-card__meta" id="mobIosMeta">
								{ios.meta}
							</p>
						</div>
						<ol className="mob-card__steps">
							<li>把 IPA 下载到电脑。</li>
							<li>
								电脑装 <a href="https://sideloadly.io" target="_blank" rel="noopener noreferrer">Sideloadly</a>，手机连上电脑，填入 Apple ID 后签名安装。
							</li>
							<li>免费账号签出的 App 有效期 7 天，到期重签一次即可。</li>
							<li>打开 App，在桌面上点「手机扫码连接」完成配对。</li>
						</ol>
					</article>

					<article className={platform === "android" ? "mob-card is-detected reveal" : "mob-card reveal"} data-mob="android">
						<header className="mob-card__head">
							<h3 className="mob-card__title">Android</h3>
							<p className="mob-card__tag">APK 直装</p>
						</header>
						<p className="mob-card__desc">APK 由发版流程用固定密钥签名，与桌面版同一次发布，装好即用。</p>
						<div className="mob-card__cta">
							<a className="btn btn--ghost" id="mobAndroidHref" href={android.href}>
								<Icon.Download />
								<span>{android.label}</span>
							</a>
							<p className="mob-card__meta" id="mobAndroidMeta">
								{android.meta}
							</p>
						</div>
						<ol className="mob-card__steps">
							<li>用手机浏览器打开本页，下载 APK。</li>
							<li>按系统提示允许「安装未知来源应用」，然后安装。</li>
							<li>桌面上点「手机扫码连接」，扫码完成配对。</li>
						</ol>
					</article>
				</div>
			</div>
		</section>
	);
}

export function DownloadPage() {
	return (
		<>
			<Hero />

			<section className="band dl-matrix">
				<div className="wrap">
					<div className="dl-split">
						{PLATFORMS.map((platform) => (
							<article className="dl-card reveal" key={platform.name}>
								<h2 className="dl-card__title">{platform.name}</h2>
								<p className="dl-card__desc">{platform.desc}</p>
								<ul className="dl-links">
									{platform.links.map(([label, href]) => (
										<li key={label}>
											<a href={href} target="_blank" rel="noopener noreferrer">
												<span>{label}</span>
											</a>
										</li>
									))}
								</ul>
							</article>
						))}
					</div>
				</div>
			</section>

			<Mobile />

			<section className="band band--tight">
				<div className="wrap">
					<div className="dl-faq reveal">
						<div className="dl-faq__col">
							<h3 className="dl-faq__title">装不上 / 被拦下</h3>
							<dl className="dl-faq__list">
								<div>
									<dt>macOS 提示无法验证开发者</dt>
									<dd>系统设置 → 隐私与安全性，允许一次即可。</dd>
								</div>
								<div>
									<dt>Windows SmartScreen 弹窗</dt>
									<dd>点「更多信息 → 仍要运行」。包未做付费签名，源码可自行核对。</dd>
								</div>
							</dl>
						</div>
						<div className="dl-faq__col">
							<h3 className="dl-faq__title">版本从哪来</h3>
							<dl className="dl-faq__list">
								<div>
									<dt>当前 v{DOWNLOAD_VERSION}</dt>
									<dd>每次发版同步更新本页与 GitHub Releases。</dd>
								</div>
								<div>
									<dt>想找旧版本</dt>
									<dd>
										在 <a href="https://github.com/maomaochong-ai/astravia/releases" target="_blank" rel="noopener noreferrer">Releases</a> 查看变更与历史产物。
									</dd>
								</div>
							</dl>
						</div>
					</div>
				</div>
			</section>
		</>
	);
}
