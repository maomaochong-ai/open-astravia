import { useEffect, useRef, useState } from "react";
import { type RoutePath, useRoutePath } from "./router";
import { useTheme } from "./theme";
import { ExternalLink, Icon, Link, useReveal } from "./ui";

const NAV_ITEMS: { path: RoutePath; label: string; icon: "grid" | "spark" | "download" | "info" }[] = [
	{ path: "/", label: "产品", icon: "grid" },
	{ path: "/features", label: "功能", icon: "spark" },
	{ path: "/download", label: "下载", icon: "download" },
	{ path: "/about", label: "关于", icon: "info" },
];

const NAV_ICONS = {
	grid: (
		<>
			<rect x="3" y="3" width="7" height="7" rx="1.6" />
			<rect x="14" y="3" width="7" height="7" rx="1.6" />
			<rect x="3" y="14" width="7" height="7" rx="1.6" />
			<rect x="14" y="14" width="7" height="7" rx="1.6" />
		</>
	),
	spark: (
		<>
			<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z" />
			<path d="m18.5 16 .9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9Z" />
		</>
	),
	download: (
		<>
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
			<path d="m7 10 5 5 5-5" />
			<path d="M12 15V3" />
		</>
	),
	info: (
		<>
			<circle cx="12" cy="12" r="9" />
			<path d="M12 11v5" />
			<path d="M12 8h.01" />
		</>
	),
};

export function SiteHeader() {
	const { theme, toggle } = useTheme();
	const toggleRef = useRef<HTMLButtonElement | null>(null);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		const onScroll = () => {
			const nav = document.querySelector(".nav");
			nav?.classList.toggle("is-scrolled", window.scrollY > 8);
		};
		onScroll();
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => window.removeEventListener("scroll", onScroll);
	}, []);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || !open) return;
			setOpen(false);
			toggleRef.current?.focus();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, setOpen]);

	return (
		<header className={open ? "nav open" : "nav"}>
			<div className="nav__inner">
				<Link to="/" className="nav__brand" ariaLabel="Astravia 首页">
					<img className="nav__mark" src="/banner-rounded.png" width="26" height="26" alt="" />
					<span className="nav__name">Astravia</span>
				</Link>

				<nav className="nav__pill" id="navLinks" aria-label="主导航">
					{NAV_ITEMS.map((item) => (
						<Link
							key={item.path}
							to={item.path}
							className="nav__link"
							onClick={() => setOpen(false)}
						>
							<svg
								aria-hidden="true"
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.7"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								{NAV_ICONS[item.icon]}
							</svg>
							<span>{item.label}</span>
						</Link>
					))}
				</nav>

				<div className="nav__actions">
					<ExternalLink
						href="https://github.com/maomaochong-ai/open-astravia"
						className="nav__gh"
						ariaLabel="在 GitHub 上查看源码"
					>
						<Icon.GitHub size={16} />
					</ExternalLink>
					<button
						className={theme === "dark" ? "nav__theme is-dark" : "nav__theme is-light"}
						type="button"
						aria-pressed={theme === "dark"}
						aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
						onClick={toggle}
					>
						<svg
							aria-hidden="true"
							width="15"
							height="15"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.6"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
						</svg>
					</button>
					<button
						className="nav__toggle"
						ref={toggleRef}
						type="button"
						aria-expanded={open}
						aria-label={open ? "关闭菜单" : "打开菜单"}
						aria-controls="navLinks"
						onClick={() => setOpen(!open)}
					>
						<span />
						<span />
					</button>
				</div>
			</div>
		</header>
	);
}

export function SiteFooter() {
	const year = new Date().getFullYear();
	const { theme } = useTheme();
	// 海报自带底色：深色主题用深底那张，浅色主题换浅底那张，否则和界面撞出粗边框。
	const wechatPoster = theme === "light" ? "/community/wechat-group-light.png" : "/community/wechat-group.png";
	return (
		<footer className="footer">
			<div className="wrap">
				<div className="footer__grid">
					<div className="footer__brand-col">
						<Link to="/" className="footer__brand">
							<img src="/banner-rounded.png" width="26" height="26" alt="" />
							<span>Astravia</span>
						</Link>
						<p className="footer__brand-desc">
							开源、本地优先的 AI Agent 工作台——模型与密钥自配，数据留在本机。
						</p>
						<ul className="footer__social" aria-label="项目入口">
							<li>
								<ExternalLink href="https://github.com/maomaochong-ai/open-astravia" ariaLabel="GitHub">
									<Icon.GitHub />
								</ExternalLink>
							</li>
							<li>
								<ExternalLink href="https://github.com/maomaochong-ai/astravia/issues" ariaLabel="Issues">
									<Icon.Issue />
								</ExternalLink>
							</li>
							<li>
								<a href="mailto:hello@astravia.dev" aria-label="邮件联系">
									<Icon.Mail />
								</a>
							</li>
						</ul>
					</div>

					<nav className="footer__links" aria-label="页脚导航">
						<div className="footer__link-group">
							<p className="footer__link-heading">产品</p>
							<ul>
								<li>
									<Link to="/">产品</Link>
								</li>
								<li>
									<Link to="/features">功能</Link>
								</li>
								<li>
									<Link to="/download">下载</Link>
								</li>
							</ul>
						</div>
						<div className="footer__link-group">
							<p className="footer__link-heading">资源</p>
							<ul>
								<li>
									<ExternalLink href="https://docs.astravia.dev">文档</ExternalLink>
								</li>
								<li>
									<ExternalLink href="https://github.com/maomaochong-ai/open-astravia">开源</ExternalLink>
								</li>
								<li>
									<ExternalLink href="https://github.com/maomaochong-ai/astravia/releases">更新日志</ExternalLink>
								</li>
							</ul>
						</div>
						<div className="footer__link-group">
							<p className="footer__link-heading">关于</p>
							<ul>
								<li>
									<Link to="/about">关于 Astravia</Link>
								</li>
								<li>
									<ExternalLink href="https://github.com/maomaochong-ai/astravia/issues/new">联系我们</ExternalLink>
								</li>
								<li>
									<ExternalLink href="https://github.com/maomaochong-ai/astravia/blob/main/LICENSE">Apache-2.0</ExternalLink>
								</li>
							</ul>
						</div>
					</nav>

					<div className="footer__community">
						<p className="footer__link-heading">社群</p>
						<div className="qr-row">
							<a
								className="qr-card"
								href="/community/qq-group.png"
								target="_blank"
								rel="noopener noreferrer"
								aria-label="查看 QQ 群官方海报"
							>
								<span className="qr-card__plate">
									<img src="/community/qr-qq.png" width="528" height="528" alt="QQ 官方群二维码" loading="lazy" decoding="async" />
								</span>
								<span className="qr-card__label">
									<i className="qr-card__dot qr-card__dot--qq" aria-hidden="true" />
									QQ 群
								</span>
							</a>
							<a
								className="qr-card"
								href={wechatPoster}
								target="_blank"
								rel="noopener noreferrer"
								aria-label="查看微信群官方海报"
							>
								<span className="qr-card__plate">
									<img src="/community/qr-wechat.png" width="784" height="784" alt="微信官方群二维码" loading="lazy" decoding="async" />
								</span>
								<span className="qr-card__label">
									<i className="qr-card__dot qr-card__dot--wechat" aria-hidden="true" />
									微信群
								</span>
							</a>
						</div>
					</div>
				</div>

				<div className="footer__bottom">
					<p>© {year} Astravia · Apache-2.0</p>
					<p>本地优先 · 模型自配 · 数据自持</p>
				</div>
			</div>
		</footer>
	);
}

/** 页面骨架：导航 + 主内容 + 页脚，滚动显现也在这里统一挂载。 */
export function Layout({ children }: { children: React.ReactNode }) {
	const path = useRoutePath();
	useReveal(path);
	return (
		<>
			<a className="skip" href="#main">
				跳到主要内容
			</a>
			<SiteHeader />
			<main id="main">
				{children}
			</main>
			<SiteFooter />
		</>
	);
}
