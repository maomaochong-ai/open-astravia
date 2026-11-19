import { useEffect, useState } from "react";
import { useTheme } from "../app/theme";
import { Icon, Link, ExternalLink } from "../app/ui";

/* ---------- 数据 ---------- */

const PROVIDERS = [
	{ src: "/download/openai.webp", alt: "OpenAI" },
	{ src: "/download/ollama.webp", alt: "Ollama" },
	{ src: "/download/kimi.webp", alt: "Kimi" },
	{ src: "/download/grok.webp", alt: "Grok" },
	{ src: "/download/mistral.webp", alt: "Mistral" },
	{ src: "/download/doubao.webp", alt: "豆包" },
	{ src: "/download/minimax.webp", alt: "MiniMax" },
	{ src: "/download/zai.webp", alt: "Z.ai" },
];

const PROMISES = [
	{
		title: "数据安全",
		desc: "离线运行，或部署在你自己的基础设施中。",
		icon: (
			<>
				<rect x="4" y="10" width="16" height="11" rx="2.4" />
				<path d="M8 10V7a4 4 0 0 1 8 0v3" />
			</>
		),
	},
	{
		title: "模型自由",
		desc: "使用自己的密钥、模型与端点。",
		icon: (
			<>
				<path d="m12 2 9 5-9 5-9-5 9-5Z" />
				<path d="m3 12 9 5 9-5" />
				<path d="m3 17 9 5 9-5" />
			</>
		),
	},
	{
		title: "可扩展平台",
		desc: "插件、技能与 API，面向规模扩展。",
		icon: (
			<>
				<rect x="3" y="3" width="7" height="7" rx="1.6" />
				<rect x="14" y="3" width="7" height="7" rx="1.6" />
				<rect x="3" y="14" width="7" height="7" rx="1.6" />
				<rect x="14" y="14" width="7" height="7" rx="1.6" />
			</>
		),
	},
];

export type JourneyStep = {
	id: string;
	num: string;
	title: string;
	desc: string;
	chipLabel: string;
	chipText: string;
};

const JOURNEY: JourneyStep[] = [
	{
		id: "需求",
		num: "01 · 提出需求",
		title: "交给 Astravia 材料，也告诉它最终目标",
		desc: "选择「网站发布」工作流，附上已经确认的材料文件，再用一句话说明希望交付的结果。",
		chipLabel: "输入已准备",
		chipText: "已添加 3 个源文件",
	},
	{
		id: "执行",
		num: "02 · 执行任务",
		title: "让计划变成看得见的工作过程",
		desc: "智能体读取材料、生成简明计划、调用所需工具，并在可检查的任务列表中逐步推进。",
		chipLabel: "任务已完成",
		chipText: "完成 4 个步骤 · 修改 4 个文件",
	},
	{
		id: "交付",
		num: "03 · 交付结果",
		title: "审阅真正的结果，而不是另一段聊天记录",
		desc: "Astravia 在项目旁直接打开响应式网站草稿，并汇总修改文件与检查状态，方便立即审阅。",
		chipLabel: "输出已就绪",
		chipText: "网站草稿可以开始审阅",
	},
	{
		id: "沉淀",
		num: "04 · 一键沉淀",
		title: "把刚交付的文件收进知识库",
		desc: "在文件列表中多选产出文件，右键选择「添加到知识库」，下一次任务就能直接检索这些材料。",
		chipLabel: "已加入知识库",
		chipText: "4 个交付文件可复用",
	},
	{
		id: "知识",
		num: "05 · 知识沉淀",
		title: "在知识库里立刻看到刚添加的文件",
		desc: "刚才选中的交付文件出现在知识工作区，智能体可以在后续任务中检索与复用。",
		chipLabel: "知识工作区",
		chipText: "文件可持续检索和复用",
	},
];

const PLUGINS = [
	{ src: "/plugins/astravia-ui-design.png", alt: "Astravia UI Design" },
	{ src: "/plugins/content-creation.png", alt: "内容创作" },
	{ src: "/plugins/browser.png", alt: "浏览器操作" },
	{ src: "/plugins/chart-renderer.png", alt: "图表渲染" },
	{ src: "/plugins/image-gen.png", alt: "图像生成" },
	{ src: "/plugins/office-viewer.png", alt: "Office 查看器" },
	{ src: "/plugins/media-viewer.png", alt: "媒体查看器" },
	{ src: "/plugins/svg-viewer.png", alt: "SVG Viewer" },
	{ src: "/plugins/git.png", alt: "Git" },
	{ src: "/plugins/plugin-workbench.png", alt: "制作插件" },
	{ src: "/plugins/astravia-actions.png", alt: "Astravia Actions" },
];

const SKILL_LINES = [
	"---",
	"name: market-analyst",
	"description: >",
	"  Analyze market trends and",
	"  summarize insights for the team.",
	"---",
	"",
	"# Market Analyst",
	"",
	"## When to use",
	"- Research competitors",
	"- Summarize pricing signals",
	"- Compare release notes",
	"",
	"## Steps",
	"1. Gather sources",
	"2. Extract key metrics",
	"3. Cluster themes",
	"4. Write a short brief",
	"5. Share with the team",
];

const KB_STEPS = [
	{ id: "put", label: "放入" },
	{ id: "tidy", label: "整理" },
	{ id: "find", label: "找到" },
	{ id: "answer", label: "回答" },
];

const FAQ = [
	{
		key: "what",
		q: "什么是星轨 Astravia？",
		hint: "产品与品牌形象",
		a: "一套开源、本地优先的 AI Agent 桌面应用：对话、编码、文档、数据库、批量任务、定时任务与设计画布都在同一个工作区里，模型与密钥由你自己配置。",
	},
	{
		key: "open",
		q: "星轨是开源的吗？",
		hint: "可查看、可自用、可参与",
		a: "是。Apache-2.0 许可，客户端与服务端的可开源部分都在 GitHub 上，可查看、可自托管、可二次开发。",
	},
	{
		key: "extend",
		q: "星轨能扩展哪些能力？",
		hint: "官方与社区，都能装、也能自己写",
		a: "插件与技能能给应用加面板、加工具，MCP 能接外部服务；三者都能自己写，也能从能力市场装。官方与社区并行，装不装由你决定。",
	},
	{
		key: "privacy",
		q: "我的数据安全吗？",
		hint: "开源可查，数据在本地",
		a: "会话、工作区、知识库与数据库连接默认都在本机 ~/.astravia，密钥存系统钥匙串；没有遥测、没有崩溃上报，出站请求只发生在你配置的服务商与插件上。",
	},
	{
		key: "plugin",
		q: "插件能做什么？",
		hint: "扩展应用本身，而不只是多一个工具",
		a: "扩展应用本身，而不只是多一个工具：新增侧栏面板、活动区标签页与命令，接入数据库、外部 API 或内部系统，并把结果留在同一份工作区记录里。",
	},
];

/* ---------- 通用小件 ---------- */

function SectionHead({
	eyebrow,
	title,
	sub,
	center,
}: {
	eyebrow?: string;
	title: React.ReactNode;
	sub?: string;
	center?: boolean;
}) {
	return (
		<header className={center ? "section-head section-head--center reveal" : "section-head reveal"}>
			{eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
			<h2 className="display display--md">{title}</h2>
			{sub ? <p className="lede">{sub}</p> : null}
		</header>
	);
}

function Window({
	title,
	tag,
	children,
	dots,
	className,
}: {
	title?: string;
	tag?: string;
	children: React.ReactNode;
	dots?: boolean;
	className?: string;
}) {
	return (
		<div className={className ? `window ${className}` : "window"}>
			<div className="window__bar">
				{dots ? (
					<span className="window__dots">
						<i />
						<i />
						<i />
					</span>
				) : null}
				<span className="window__file">{title}</span>
				{tag ? <span className="window__tag">{tag}</span> : null}
			</div>
			{children}
		</div>
	);
}

/* ---------- 首屏 ---------- */

function Hero() {
	const { theme } = useTheme();
	const shot = theme === "dark" ? "/app/app-dark.webp" : "/app/app-light.webp";

	return (
		<section className="hero">
			<div className="hero__grid" aria-hidden="true" />
			<div className="hero__glow" aria-hidden="true" />
			<div className="wrap hero__inner">
				<div className="hero__copy">
					<h1 className="hero__title">
						开源 Agent，
						<br />
						为真实工作而生。
					</h1>
					<p className="hero__sub">
						Astravia 面向工作与编程场景，与开源社区共同打造个人与企业可定制、可扩展、可掌控的 AI Agent。
					</p>
					<div className="hero__actions">
						<Link to="/download" className="btn btn--solid btn--lg">
							<Icon.Download />
							<span>下载客户端</span>
						</Link>
						<ExternalLink href="https://github.com/maomaochong-ai/open-astravia" className="link-arrow">
							在 GitHub 上探索
							<span>
								<Icon.Arrow />
							</span>
						</ExternalLink>
					</div>
					<ul className="hero__meta">
						<li>开源</li>
						<li>隐私优先</li>
						<li>私有化部署</li>
						<li>跨平台</li>
					</ul>
					<div className="hero__providers">
						<p className="hero__providers-label">支持主流服务商与本地推理</p>
						<ul className="provider-strip" aria-label="支持的模型服务商">
							{PROVIDERS.map((p) => (
								<li key={p.alt}>
									<img src={p.src} width="26" height="26" alt={p.alt} loading="lazy" />
								</li>
							))}
						</ul>
					</div>
				</div>

				<figure className="hero__shot reveal">
					<div className="hero__shot-glow" aria-hidden="true" />
					<div className="hero__shot-frame">
						<img
							className="hero__shot-img"
							src={shot}
							width="2400"
							height="1502"
							alt="Astravia 桌面应用：左侧会话与项目导航，右侧能力与插件工作区"
							decoding="async"
						/>
					</div>
				</figure>
			</div>
		</section>
	);
}

/* ---------- 隐私 ---------- */

function Privacy() {
	return (
		<section className="band band--tight">
			<div className="wrap privacy">
				<div className="privacy__intro reveal">
					<p className="eyebrow">为掌控而设计</p>
					<h2 className="display display--md">
						你的数据。
						<br />
						你的隐私。
					</h2>
					<p className="lede">Astravia 跑在你指定的环境。连接自己的模型、工具与数据——始终由你掌控。</p>
				</div>
				<ul className="promises">
					{PROMISES.map((item) => (
						<li className="promise reveal" key={item.title}>
							<span className="promise__ico" aria-hidden="true">
								<svg
									width="17"
									height="17"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.6"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									{item.icon}
								</svg>
							</span>
							<h3 className="promise__title">{item.title}</h3>
							<p className="promise__desc">{item.desc}</p>
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}

/* ---------- 任务走查 ---------- */

function JourneyPanel({ step }: { step: JourneyStep }) {
	if (step.id === "需求") {
		return (
			<Window title="Astravia" dots className="window">
				<div className="window__body window__body--home">
					<p className="mock-h1">今天想完成什么？</p>
					<p className="mock-sub">我可以协助你推进工作。现在要从哪里开始？</p>
					<ul className="flow-cards">
						<li className="flow-card is-on">
							<span className="flow-card__name">网站发布</span>
							<span className="flow-card__desc">根据材料生成可以交付的网站草稿。</span>
							<span className="flow-card__meta">v1.2.0 · 1280</span>
						</li>
						<li className="flow-card">
							<span className="flow-card__name">每周报告</span>
							<span className="flow-card__desc">收集进展并生成总结。</span>
							<span className="flow-card__meta">v1.0.4</span>
						</li>
						<li className="flow-card">
							<span className="flow-card__name">数据清理</span>
							<span className="flow-card__desc">规范表格并标记异常值。</span>
						</li>
					</ul>
					<div className="chip-row">
						<span>网页生成</span>
						<span>PDF 阅读</span>
						<span>检查清单</span>
						<span>浏览器</span>
					</div>
					<div className="input-box">
						<p className="input-box__placeholder">询问 Astravia，输入 / 使用技能，输入 @ 引用文件</p>
						<div className="input-box__foot">
							<span className="input-box__tools">＋ ⌘ ⇧</span>
							<span className="input-box__mode">沙盒模式</span>
						</div>
					</div>
				</div>
			</Window>
		);
	}

	if (step.id === "执行") {
		return (
			<Window title="任务清单" tag="4 / 4" dots>
				<div className="window__body">
					<ol className="plan">
						{["读取 3 份材料，提取品牌与产品信息", "搭建首页与两个子页面的结构", "补齐响应式布局与暗色主题", "本地起服务自检，修复溢出与对比度"].map(
							(text, index) => (
								<li className="plan__row is-done" key={text}>
									<span className="plan__tick" />
									<span className="plan__text">{text}</span>
									<span className="plan__meta">{["2 个工具", "写 4 个文件", "写 2 个文件", "4 项检查"][index]}</span>
								</li>
							),
						)}
					</ol>
					<div className="tool-log">
						{[
							["read_file", "materials/brand.md", ""],
							["write_file", "site/index.html", ""],
							["run_command", "npm run build", "通过"],
						].map(([name, arg, ok]) => (
							<div className="tool-log__row" key={arg}>
								<span className="tool-log__name">{name}</span>
								<code>{arg}</code>
								<span className="tool-log__ok">
									<Icon.Check />
									{ok}
								</span>
							</div>
						))}
					</div>
				</div>
			</Window>
		);
	}

	if (step.id === "交付") {
		return (
			<div className="window window--split">
				<div className="window__pane">
					<div className="window__bar">
						<span className="window__file">交付物</span>
						<span className="window__tag">4 个文件</span>
					</div>
					<ul className="file-list">
						<li className="file-row is-on">
							<span className="file-ico file-ico--html">HTML</span>
							<span className="file-name">site/index.html</span>
							<span className="file-meta">12.4 KB</span>
						</li>
						<li className="file-row">
							<span className="file-ico file-ico--css">CSS</span>
							<span className="file-name">site/style.css</span>
							<span className="file-meta">+318 行</span>
						</li>
						<li className="file-row">
							<span className="file-ico file-ico--ts">TS</span>
							<span className="file-name">site/main.ts</span>
							<span className="file-meta">已修改</span>
						</li>
						<li className="file-row">
							<span className="file-ico file-ico--md">MD</span>
							<span className="file-name">site/README.md</span>
							<span className="file-meta">2.1 KB</span>
						</li>
					</ul>
				</div>
				<div className="window__pane window__pane--preview">
					<div className="preview-bar">
						<span>响应式预览</span>
						<span className="preview-bar__tag">1440 × 900</span>
					</div>
					<div className="preview-canvas">
						<div className="preview-canvas__bar" />
						<div className="preview-canvas__hero">
							<span className="preview-canvas__title" />
							<span className="preview-canvas__line" />
							<span className="preview-canvas__line preview-canvas__line--short" />
							<span className="preview-canvas__btn" />
						</div>
						<div className="preview-canvas__grid">
							<i />
							<i />
							<i />
						</div>
					</div>
					<p className="preview-foot">检查通过：无横向溢出 · 对比度达标</p>
				</div>
			</div>
		);
	}

	if (step.id === "沉淀") {
		return (
			<Window title="交付物" tag="已选 4 个">
				<div className="window__body">
					<ul className="file-list file-list--select">
						{[
							["file-ico--html", "HTML", "site/index.html"],
							["file-ico--css", "CSS", "site/style.css"],
							["file-ico--ts", "TS", "site/main.ts"],
							["file-ico--md", "MD", "site/README.md"],
						].map(([ico, label, name]) => (
							<li className="file-row is-checked" key={name}>
								<span className="file-check" />
								<span className={`file-ico ${ico}`}>{label}</span>
								<span className="file-name">{name}</span>
							</li>
						))}
					</ul>
					<div className="context-menu">
						<span className="context-menu__item">打开</span>
						<span className="context-menu__item">在文件管理器中显示</span>
						<span className="context-menu__item is-on">添加到知识库</span>
					</div>
				</div>
			</Window>
		);
	}

	return (
		<Window title="知识工作区" tag="4 个新条目">
			<div className="window__body">
				<div className="kb-mini">
					{[
						["网站", "首页结构与文案", "来自 site/index.html"],
						["样式", "响应式与暗色主题", "来自 site/style.css"],
						["交互", "导航与表单行为", "来自 site/main.ts"],
					].map(([tag, title, meta]) => (
						<div className="kb-mini__note" key={title}>
							<span className="kb-mini__tag">{tag}</span>
							<span className="kb-mini__title">{title}</span>
							<span className="kb-mini__meta">{meta}</span>
						</div>
					))}
				</div>
				<p className="mock-foot">这些条目已进入索引，下一次任务可以直接检索。</p>
			</div>
		</Window>
	);
}

function Journey() {
	const [active, setActive] = useState(JOURNEY[0].id);
	const current = JOURNEY.find((step) => step.id === active) ?? JOURNEY[0];

	return (
		<section className="band" data-section="journey">
			<div className="wrap">
				<SectionHead eyebrow="在 Astravia 中完成一个真实任务" title={<>看见工作如何<br />向前推进</>} />

				<div className="journey">
					<div className="journey__steps" role="tablist" aria-orientation="vertical" aria-label="任务步骤">
						{JOURNEY.map((step) => (
							<button
								key={step.id}
								className={step.id === active ? "step-card is-active reveal" : "step-card reveal"}
								type="button"
								role="tab"
								aria-selected={step.id === active}
								onClick={() => setActive(step.id)}
							>
								<span className="step-card__num">{step.num}</span>
								<span className="step-card__title">{step.title}</span>
								<span className="step-card__desc">{step.desc}</span>
								<span className="step-card__chip">
									<Icon.Check />
									<em>{step.chipLabel}</em>
									{step.chipText}
								</span>
							</button>
						))}
					</div>

					<div className="journey__stage">
						<div className="stage-panel is-active" key={current.id}>
							<JourneyPanel step={current} />
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

/* ---------- 技能与插件生态 ---------- */

function Ecosystem() {
	return (
		<section className="band" data-section="ecosystem">
			<div className="wrap">
				<div className="eco">
					<div className="eco__intro reveal">
						<p className="eyebrow">技能与插件生态</p>
						<h2 className="display display--md">
							天生可扩展。
							<br />
							边界由你定义。
						</h2>
						<p className="lede">Astravia 与你一起成长。构建自定义技能，用插件扩展能力，并连接你依赖的工具。</p>
					</div>

					<div className="orbit reveal" aria-hidden="true">
						<svg className="orbit__links" viewBox="0 0 620 420" preserveAspectRatio="none">
							<path d="M196 48C300 70 440 150 556 198" />
							<path d="M196 207C300 207 440 209 556 210" />
							<path d="M196 366C300 344 440 268 556 224" />
						</svg>
						{[
							["a", "研究", "网页检索、分析与摘要", <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" /></>],
							["b", "数据智能", "查询、可视化与洞察提取", <><path d="M4 20V6" /><path d="M10 20v-8" /><path d="M16 20V9" /><path d="M22 20v-4" /></>],
							["c", "自动化", "工作流、调度与动作执行", <><path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" /></>],
						].map(([slot, name, desc, icon]) => (
							<div className={`orbit__node orbit__node--${slot as string}`} key={name as string}>
								<span className="orbit__ico">
									<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
										{icon as React.ReactNode}
									</svg>
								</span>
								<span className="orbit__name">{name as string}</span>
								<span className="orbit__desc">{desc as string}</span>
							</div>
						))}
						<div className="orbit__core">
							<span className="orbit__ring">
								<img src="/banner-rounded.png" width="66" height="66" alt="" />
							</span>
							<span className="orbit__pill">
								<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
									<path d="m20 6-11 11-5-5" />
								</svg>
								Astravia
							</span>
							<span className="orbit__core-note">安全 · 私有 · 属于你</span>
						</div>
					</div>
				</div>

				<div className="eco-rail reveal">
					<article className="rail-panel rail-panel--wide">
						<div className="rail-panel__copy">
							<div className="rail-panel__head">
								<span className="rail-panel__ico" aria-hidden="true">
									<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
										<rect x="3" y="3" width="18" height="18" rx="3" />
										<path d="M8 12h8" />
										<path d="M12 8v8" />
									</svg>
								</span>
								<span className="rail-panel__num">01</span>
							</div>
							<h3 className="rail-panel__title">构建技能</h3>
							<p className="rail-panel__desc">按业务领域打造定制能力。</p>
						</div>
						<div className="code-panel code-panel--rail">
							<div className="code-panel__bar">
								<span className="window__dots">
									<i />
									<i />
									<i />
								</span>
								<span className="code-panel__file">SKILL.md</span>
							</div>
							<ol className="code-lines">
								{SKILL_LINES.map((line, index) => (
									<li key={`${index}-${line}`}>
										<span className={line.startsWith("#") ? "tok-k" : undefined}>{line}</span>
									</li>
								))}
							</ol>
						</div>
					</article>

					<article className="rail-panel">
						<div className="rail-panel__head">
							<span className="rail-panel__num">02</span>
							<span className="rail-panel__ico" aria-hidden="true">
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
									<rect x="3" y="3" width="7.5" height="7.5" rx="2" />
									<rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
									<rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
									<rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
								</svg>
							</span>
						</div>
						<h3 className="rail-panel__title">用插件扩展</h3>
						<p className="rail-panel__desc">即刻安装生态中的开源插件。</p>
					</article>

					<article className="rail-panel">
						<div className="rail-panel__head">
							<span className="rail-panel__num">03</span>
							<span className="rail-panel__ico" aria-hidden="true">
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
									<circle cx="12" cy="12" r="9" />
									<path d="M3 12h18" />
									<path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
								</svg>
							</span>
						</div>
						<h3 className="rail-panel__title">连接工具</h3>
						<p className="rail-panel__desc">把数据、应用与服务汇入同一工作区。</p>
					</article>
				</div>

				<div className="plugin-strip reveal">
					<p className="plugin-strip__label">
						预装插件<span>11 个 · 与第三方插件同一套 API</span>
					</p>
					<ul className="plugin-strip__list">
						{PLUGINS.map((plugin) => (
							<li key={plugin.alt}>
								<img src={plugin.src} width="30" height="30" alt={plugin.alt} loading="lazy" />
							</li>
						))}
					</ul>
				</div>

				<ul className="trust-strip reveal">
					<li>
						<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
							<rect x="4" y="10" width="16" height="11" rx="2.4" />
							<path d="M8 10V7a4 4 0 0 1 8 0v3" />
						</svg>
						默认隐私。数据与扩展由你掌控。
					</li>
					<li>
						<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
							<path d="m8 6-6 6 6 6" />
							<path d="m16 6 6 6-6 6" />
						</svg>
						开放标准，设计灵活。
					</li>
					<li>
						<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
							<path d="M4 20h16" />
							<path d="M6 16V8" />
							<path d="M12 16V4" />
							<path d="M18 16v-6" />
						</svg>
						为规模而建。
					</li>
				</ul>
			</div>
		</section>
	);
}

/* ---------- 知识库 ---------- */

function KnowledgePanel({ id }: { id: string }) {
	if (id === "put") {
		return (
			<>
				<div className="kb-panel__head">
					<span className="kb-panel__num">01</span>
					<span className="kb-panel__title">放入</span>
					<p className="kb-panel__desc">PDF、笔记、表格、导出文件都可以原样加入，不必先整理好文件夹。</p>
				</div>
				<div className="drop-zone">
					<p className="drop-zone__label">你的文件</p>
					<div className="drop-grid">
						{[
							["W", "doc"],
							["N", "note"],
							["X", "xls"],
							["C", "csv"],
							["P", "pdf"],
							["M", "md"],
						].map(([label, kind]) => (
							<span className="drop-tile" key={kind}>
								<span className={`drop-tile__ico drop-tile__ico--${kind}`}>{label}</span>
							</span>
						))}
					</div>
					<p className="drop-zone__hint">… 你平时收集的都可以</p>
				</div>
			</>
		);
	}

	if (id === "tidy") {
		return (
			<>
				<div className="kb-panel__head">
					<span className="kb-panel__num">02</span>
					<span className="kb-panel__title">整理</span>
					<p className="kb-panel__desc">Astravia 读懂每一份材料，写成一篇篇好读的笔记——有标题、有主题，以后随时能打开。</p>
				</div>
				<div className="note-list">
					{[
						["数据留存策略", "制度"],
						["架构总览", "架构"],
						["安全常见问题", "安全"],
						["发布流程与检查项", "流程"],
					].map(([title, tag]) => (
						<div className="note-row" key={title}>
							<span className="note-row__title">{title}</span>
							<span className="note-row__tag">{tag}</span>
						</div>
					))}
				</div>
			</>
		);
	}

	if (id === "find") {
		return (
			<>
				<div className="kb-panel__head">
					<span className="kb-panel__num">03</span>
					<span className="kb-panel__title">找到</span>
					<p className="kb-panel__desc">按标签、按索引，或顺着相关笔记进入——该看的上下文就在手边。</p>
				</div>
				<div className="search-mock">
					<span className="search-mock__input">查找留存与安全相关的笔记</span>
					<div className="search-mock__meta">
						<span>标签 · 数据留存策略</span>
						<span>索引 · 架构总览</span>
						<span>相关 · 安全常见问题</span>
					</div>
				</div>
			</>
		);
	}

	return (
		<>
			<div className="kb-panel__head">
				<span className="kb-panel__num">04</span>
				<span className="kb-panel__title">回答</span>
				<p className="kb-panel__desc">智能体基于整理好的笔记作答——并附上你能打开核对的来源。</p>
			</div>
			<div className="answer-mock">
				<div className="answer-mock__who">
					<img src="/banner-rounded.png" width="18" height="18" alt="" />
					<span>Astravia</span>
				</div>
				<p className="answer-mock__text">
					根据你的知识库：数据默认保留 30 天，生产日志有更严格的规则。访问遵循安全常见问题中的约定——不会超出你设定的策略边界。
				</p>
				<div className="answer-mock__sources">
					<span className="answer-mock__label">参考来源</span>
					<span>数据留存策略</span>
					<span>架构总览</span>
					<span>安全常见问题</span>
				</div>
			</div>
		</>
	);
}

function Knowledge() {
	const [active, setActive] = useState("put");

	return (
		<section className="band" data-section="knowledge">
			<div className="wrap">
				<div className="kb__head">
					<div className="reveal">
						<p className="eyebrow">Astravia 知识库</p>
						<h2 className="display display--md">
							你已有的资料，
							<br />
							变成可长期使用的知识。
						</h2>
						<p className="lede">
							把文档原样放进来即可。Astravia 会整理成条理清楚、互相关联的知识库，智能体真正用得上——你加得越多，它越得力。
						</p>
						<ul className="kb__chips">
							<li>资料在你这边</li>
							<li>来源可追溯</li>
							<li>越用越厚</li>
						</ul>
					</div>
					<div className="kb__stack reveal" aria-hidden="true">
						{[
							["PDF", "产品简版.pdf", "PDF · 3.2 MB"],
							["DOC", "工程笔记", "Word · 12 页"],
							["CSV", "客户反馈.csv", "CSV · 8.4 MB"],
							["MD", "支持文档", "Markdown · 自建"],
						].map(([label, name, meta]) => (
							<div className="stack-card" key={name}>
								<span className="stack-card__ico">{label}</span>
								<span className="stack-card__text">
									<span className="stack-card__name">{name}</span>
									<span className="stack-card__meta">{meta}</span>
								</span>
							</div>
						))}
					</div>
				</div>

				<div className="kb__body">
					<div className="kb-tabs" role="tablist" aria-label="知识库流程">
						{KB_STEPS.map((step, index) => (
							<button
								key={step.id}
								className={step.id === active ? "kb-tab is-active" : "kb-tab"}
								type="button"
								role="tab"
								aria-selected={step.id === active}
								onClick={() => setActive(step.id)}
							>
								<span className="kb-tab__num">{`0${index + 1}`}</span>
								<span className="kb-tab__label">{step.label}</span>
							</button>
						))}
					</div>

					<div className="kb-panels">
						<div className="kb-panel is-active">
							<KnowledgePanel id={active} />
						</div>
					</div>
				</div>

				<p className="kb__note reveal">
					知识始终在你这边
					<span aria-hidden="true">·</span>
					永不用于训练模型
					<span aria-hidden="true">·</span>
					整理过程你随时能看见
				</p>
			</div>
		</section>
	);
}

/* ---------- FAQ ---------- */

function Faq() {
	const [active, setActive] = useState(FAQ[0].key);
	const current = FAQ.find((item) => item.key === active) ?? FAQ[0];

	useEffect(() => {
		const list = document.getElementById("faqList");
		if (!list) return;
		const onKey = (event: KeyboardEvent) => {
			const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
			if (!keys.includes(event.key)) return;
			const index = FAQ.findIndex((item) => item.key === active);
			const next =
				event.key === "Home"
					? 0
					: event.key === "End"
						? FAQ.length - 1
						: (index + (event.key === "ArrowDown" ? 1 : FAQ.length - 1)) % FAQ.length;
			event.preventDefault();
			setActive(FAQ[next].key);
			list.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
		};
		list.addEventListener("keydown", onKey);
		return () => list.removeEventListener("keydown", onKey);
	}, [active]);

	return (
		<section className="band" data-section="faq">
			<div className="wrap">
				<SectionHead
					center
					eyebrow="问问 Astravia"
					title="开始使用前，人们最关心什么？"
					sub="关于开源、隐私、能力与插件的真实问题，用产品本身来回答。"
				/>

				<div className="faq-layout">
					<div className="faq-list" id="faqList" role="listbox" aria-label="产品常见问题">
						{FAQ.map((item) => (
							<button
								key={item.key}
								className={item.key === active ? "faq-q is-active" : "faq-q"}
								type="button"
								role="option"
								aria-selected={item.key === active}
								onClick={() => setActive(item.key)}
							>
								{item.q}
								<em>{item.hint}</em>
							</button>
						))}
					</div>

					<div className="chat" aria-live="polite">
						<div className="chat__bar">
							<span className="chat__title">认识 Astravia</span>
							<em className="chat__sub">Astravia · 问答会话</em>
							<span className="chat__state">正在回答…</span>
						</div>
						<div className="chat__body">
							<p className="chat__q">{current.q}</p>
							<div className="chat__answer">
								<div className="chat__who">
									<img src="/banner-rounded.png" width="20" height="20" alt="" />
									<span>ASTRAVIA</span>
								</div>
								<p className="chat__text">{current.a}</p>
							</div>
						</div>
						<div className="chat__input">
							<span>问 Astravia…</span>
							<i aria-hidden="true" />
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

/* ---------- 首页 ---------- */

export function HomePage() {
	return (
		<>
			<Hero />
			<Privacy />
			<Journey />
			<Ecosystem />
			<Knowledge />
			<Faq />
			<section className="close-band">
				<div className="closer__glow" aria-hidden="true" />
				<div className="wrap close-band__inner">
					<h2 className="display display--md reveal">今天就把它装到自己机器上</h2>
					<p className="lede reveal">双击即装。没有账号，没有试用期，没有额度。</p>
					<div className="close-band__actions reveal">
						<Link to="/download" className="btn btn--solid btn--lg">
							下载客户端
						</Link>
						<ExternalLink href="https://github.com/maomaochong-ai/open-astravia" className="link-arrow">
							看源码
							<span>
								<Icon.Arrow />
							</span>
						</ExternalLink>
					</div>
				</div>
			</section>
		</>
	);
}
