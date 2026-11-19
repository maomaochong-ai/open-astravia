import { useState } from "react";
import { Icon, Link, ExternalLink } from "../app/ui";

const MODES = [
	{ id: "work", label: "Work" },
	{ id: "coding", label: "Coding" },
] as const;

const WORK_ROWS = [
	{
		id: "mail",
		title: "邮件处理",
		desc: "收件摘要与回复草稿，帮你更快清掉收件箱。",
		icon: (
			<>
				<rect x="2" y="5" width="20" height="14" rx="2.4" />
				<path d="m3 7 9 6 9-6" />
			</>
		),
	},
	{
		id: "doc",
		title: "文档撰写",
		desc: "从提纲到成稿，少从空白页开始。",
		icon: (
			<>
				<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
				<path d="M14 3v5h5" />
				<path d="M9 13h6M9 17h4" />
			</>
		),
	},
	{
		id: "sheet",
		title: "表格整理",
		desc: "清洗、汇总与核对，把杂乱数据理清楚。",
		icon: (
			<>
				<rect x="3" y="4" width="18" height="16" rx="2.2" />
				<path d="M3 10h18M9 10v10" />
			</>
		),
	},
	{
		id: "todo",
		title: "日程与待办",
		desc: "从约定到提醒，把安排落到日历和清单。",
		icon: (
			<>
				<rect x="3" y="4" width="18" height="17" rx="2.4" />
				<path d="M8 2v4M16 2v4M3 10h18" />
				<path d="m9 15 2 2 4-4" />
			</>
		),
	},
];

const ANSWER_KINDS = [
	{ name: "图表", tag: "开箱即用", desc: "雷达、柱状、折线……数据算完直接落成图，结论和证据一起出现在回答里。" },
	{ name: "卡片", tag: "插件渲染", desc: "表格、图表、预览器——插件把自己的组件挂进消息，形态不限于一套模板。" },
	{ name: "更多组件", tag: "随心扩展", desc: "KPI、表单、进度条，或你自己的卡片——回答的形态没有上限，完全按你的方式 DIY。" },
];

const BULK_POINTS = [
	["可持续运行", "队列不停，跑完为止"],
	["可干预", "随时暂停或接管"],
	["可观测", "每个任务状态实时可见"],
	["可并行", "多任务同时推进"],
];

const QUEUE = [
	["project-atlas", "done"],
	["project-beacon", "done"],
	["project-cascade", "run"],
	["project-dawn", "done"],
	["project-ember", "run"],
	["project-fjord", "wait"],
	["project-grove", "done"],
	["project-harbor", "wait"],
	["project-iris", "done"],
	["project-jade", "run"],
	["project-kite", "wait"],
	["project-lumen", "done"],
	["project-mesa", "done"],
	["project-north", "wait"],
	["project-orbit", "done"],
	["project-pine", "run"],
	["project-quartz", "wait"],
	["project-river", "done"],
	["project-solace", "wait"],
	["project-tide", "run"],
	["project-umber", "done"],
	["project-vale", "wait"],
	["project-willow", "done"],
	["project-xenon", "wait"],
	["project-yarrow", "done"],
	["project-zephyr", "run"],
] as const;

const MARKET_ROWS = [
	["Ss", "表格整理", "已启用"],
	["Wb", "网页检索", "已启用"],
	["Pp", "演示文稿", "添加"],
	["Vo", "语音合成", "添加"],
	["Do", "文档写作", "已启用"],
	["Mc", "MCP 服务", "添加"],
	["Im", "图片生成", "添加"],
	["Db", "数据查询", "已启用"],
	["Cr", "定时任务", "已启用"],
	["Rv", "代码审查", "添加"],
] as const;

const PILLARS: [string, string, string][] = [
	["layers", "深入 UI 的每一处", "侧边栏面板、悬浮窗口、输入框旁的按钮、文件预览界面、聊天消息卡片、工具运行结果——把真正的 React 组件插进工作台。"],
	["cycle", "驾驶 Agent 循环", "注册工具、注入动态系统提示词、定义自动续跑策略，甚至直接接管对话。插件不只是旁观者，而是循环的一部分。"],
	["stack", "高内聚扩展", "一个插件可以把整套能力打包在一起——skills、自定义工具、内聚的 MCP Server 一并带上，装一个就成套接入。"],
	["lock", "权限即契约", "每项能力在 plugin.json 里声明、由宿主单独授权、运行时逐次校验。用户清楚知道插件能碰什么，越权即拒。"],
];

const TOOLBOX = [
	["多模型", "十余家 Provider 一键切换"],
	["OS 级沙箱", "隔离读写、网络与进程"],
	["子智能体", "派生子代理分解任务"],
	["后台任务", "长任务异步不阻塞"],
	["MCP 接入", "接入外部工具与资源"],
	["技能 Skills", "按需加载的能力包"],
	["深度思考", "六档推理强度可调"],
	["会话分支树", "随时回退或分叉"],
	["任务清单", "结构化计划可视化"],
	["记忆与知识库", "长会话不丢上下文"],
	["操作审批", "敏感操作逐项把关"],
	["文件预览", "PDF / Office 预览与 OCR"],
	["内置浏览器", "工作台内直接看网页"],
	["插件与 SDK", "可扩展面板、卡片与工具"],
	["定时调度", "cron 定时触发任务"],
];

const CHOICES = [
	["安全复核", "评估隔离强度、绕过风险与权限空档"],
	["调整实现", "规划并落地对沙箱行为的改动"],
	["补文档", "把架构整理成开发者可读的说明"],
	["其他（自定义输入）", "用一句话说明你的目标"],
];

/* ---------- 小件 ---------- */

function WorkMock({ id }: { id: string }) {
	if (id === "mail") {
		return (
			<div className="mail-mock">
				<div className="mail-mock__head">
					<span className="mail-mock__icon" aria-hidden="true">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
							<rect x="2" y="5" width="20" height="14" rx="2.4" />
							<path d="m3 7 9 6 9-6" />
						</svg>
					</span>
					<span className="mail-mock__text">
						<span className="mail-mock__title">收件箱</span>
						<span className="mail-mock__meta">Inbox · 12 未读</span>
					</span>
				</div>
				<ul className="mail-list">
					{[
						["Alex · Q3 计划", "方便起草一份回复吗…"],
						["财务", "发票已附上"],
						["团队同步", "昨天的会议纪要"],
					].map(([from, subject]) => (
						<li className="mail-row" key={from}>
							<span className="mail-row__from">{from}</span>
							<span className="mail-row__subject">{subject}</span>
						</li>
					))}
				</ul>
				<p className="mail-mock__draft">草稿已就绪 · 确认后发送</p>
			</div>
		);
	}
	if (id === "doc") {
		return (
			<div className="doc-mock">
				<div className="doc-mock__bar">
					<span>季度复盘.docx</span>
					<span className="doc-mock__tag">正在写入</span>
				</div>
				<div className="doc-mock__body">
					<p className="doc-mock__h">一、本季度进展</p>
					<p className="doc-mock__p">目标完成率 86%，其中渠道建设与交付节奏是主要拉动项。</p>
					<p className="doc-mock__h">二、问题与风险</p>
					<p className="doc-mock__p">测试环境不稳定造成的返工占比 12%，建议先补自动化。</p>
					<p className="doc-mock__cursor" />
				</div>
			</div>
		);
	}
	if (id === "sheet") {
		return (
			<div className="sheet-mock">
				<table>
					<thead>
						<tr>
							<th>客户</th>
							<th>金额</th>
							<th>状态</th>
						</tr>
					</thead>
					<tbody>
						{[
							["华东区", "¥ 128,400", "ok", "已核对"],
							["华南区", "¥ 96,200", "ok", "已核对"],
							["西北区", "¥ 41,800", "warn", "待确认"],
							["东北区", "¥ 12,300", "ok", "已核对"],
						].map(([name, amount, state, label]) => (
							<tr key={name}>
								<td>{name}</td>
								<td>{amount}</td>
								<td>
									<span className={`pill pill--${state}`}>{label}</span>
								</td>
							</tr>
						))}
					</tbody>
				</table>
				<p className="sheet-mock__foot">已清洗 3 列、标记 1 处异常值</p>
			</div>
		);
	}
	return (
		<div className="todo-mock">
			<div className="todo-mock__day">今天</div>
			<ul className="todo-list">
				{[
					["10:00", "产品评审 · 首页改版", "ok", "已加入日历"],
					["14:30", "与设计对齐交互细节", "muted", "待提醒"],
					["16:00", "提交本周进展", "ok", "已加入清单"],
				].map(([time, text, state, label]) => (
					<li className="todo-row" key={text}>
						<span className="todo-row__time">{time}</span>
						<span className="todo-row__text">{text}</span>
						<span className={`pill pill--${state}`}>{label}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

function ModeSwitch({ mode, onChange }: { mode: string; onChange: (next: string) => void }) {
	return (
		<div className="mode-switch" role="tablist" aria-label="使用场景">
			{MODES.map((item) => (
				<button
					key={item.id}
					className={item.id === mode ? "mode-switch__btn is-active" : "mode-switch__btn"}
					type="button"
					role="tab"
					aria-selected={item.id === mode}
					onClick={() => onChange(item.id)}
				>
					<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
						{item.id === "work" ? (
							<>
								<rect x="2.5" y="7" width="19" height="13" rx="2.4" />
								<path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
							</>
						) : (
							<>
								<path d="m8 6-6 6 6 6" />
								<path d="m16 6 6 6-6 6" />
							</>
						)}
					</svg>
					<span>{item.label}</span>
				</button>
			))}
		</div>
	);
}

function SectionHead({ eyebrow, title, sub, center }: { eyebrow: string; title: string; sub?: string; center?: boolean }) {
	return (
		<header className={center ? "section-head section-head--center reveal" : "section-head reveal"}>
			<p className="eyebrow">{eyebrow}</p>
			<h2 className="display display--sm">{title}</h2>
			{sub ? <p className={center ? "lede lede--center" : "lede"}>{sub}</p> : null}
		</header>
	);
}

/* ---------- 页面 ---------- */

export function FeaturesPage() {
	const [mode, setMode] = useState<string>("work");
	const [work, setWork] = useState("mail");
	const [kind, setKind] = useState(0);

	return (
		<div className="page-features">
			<section className="page-hero">
				<div className="hero__grid" aria-hidden="true" />
				<div className="page-hero__glow" aria-hidden="true" />
				<div className="wrap">
					<ModeSwitch mode={mode} onChange={setMode} />

					{mode === "work" ? (
						<div className="mode-panel is-active">
							<h1 className="display page-hero__title reveal">让 Astravia 协助你的日常工作</h1>
							<p className="page-hero__sub reveal">
								邮件处理、文档撰写、表格整理、日程与待办——Astravia Work 围绕你每天的真实事务构建，把重复工作交给可掌控的智能体，并在关键分叉主动向你确认，而不是替你瞎猜。
							</p>

							<div className="work">
								<div className="work__list" role="tablist" aria-orientation="vertical" aria-label="工作场景">
									{WORK_ROWS.map((row) => (
										<button
											key={row.id}
											className={row.id === work ? "work-row is-active" : "work-row"}
											type="button"
											role="tab"
											aria-selected={row.id === work}
											onClick={() => setWork(row.id)}
										>
											<span className="work-row__ico" aria-hidden="true">
												<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
													{row.icon}
												</svg>
											</span>
											<span className="work-row__title">{row.title}</span>
											<span className="work-row__desc">{row.desc}</span>
										</button>
									))}
								</div>
								<div className="work__stage">
									<div className="work-panel is-active" key={work}>
										<WorkMock id={work} />
									</div>
								</div>
							</div>
						</div>
					) : (
						<div className="mode-panel is-active">
							<h1 className="display page-hero__title reveal">Astravia 擅长编程</h1>
							<p className="page-hero__sub reveal">
								编码能力围绕真实开发流程构建：内置 Git 审阅、并行工作流、可溯源的代码库引用，以及在关键分叉主动向你确认——而不是替你瞎猜。
							</p>
						</div>
					)}
				</div>
			</section>

			{mode === "work" ? (
				<>
					<section className="band band--tight">
						<div className="wrap duo">
							<div className="duo__media reveal">
								<div className="chat chat--inline">
									<div className="chat__bar">
										<span className="chat__title">Astravia</span>
										<em className="chat__sub">刚刚 · 12.4s</em>
										<span className="chat__state">显示 2 个步骤</span>
									</div>
									<div className="chat__body">
										<p className="chat__q chat__q--inline">帮我汇总本季度各渠道的转化表现，并给出图表。</p>
										<div className="chat__answer">
											<div className="chat__who">
												<img src="/banner-rounded.png" width="20" height="20" alt="" />
												<span>ASTRAVIA</span>
											</div>
											<p className="chat__step">
												已完成渠道分析
												<Icon.Chevron size={11} className="ico-chevron" />
											</p>
											<p className="chat__text chat__text--muted">
												本季度六个渠道中，自然搜索与内容营销领先，转化率分别为 78% 与 72%；付费投放环比回落至 54%。下方雷达图对照了本季与上季的渠道健康度。
											</p>
											<div className="chart-card">
												<div className="chart-card__head">
													<span>渠道健康度对比</span>
													<span className="chart-card__tag">雷达图</span>
												</div>
												<svg className="radar" viewBox="0 0 240 160" role="img" aria-label="本季与上季渠道健康度雷达图示意">
													<g stroke="currentColor" strokeOpacity="0.18" fill="none">
														<path d="M120 12 208 75 174 147H66L32 75Z" />
														<path d="M120 42 176 82 155 122H85L64 82Z" />
														<path d="M120 72 144 89 137 112H103L96 89Z" />
													</g>
													<path d="M120 22 196 78 166 138H74L44 78Z" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.4" />
													<path d="M120 40 180 82 158 120H82L60 82Z" fill="none" stroke="currentColor" strokeOpacity="0.75" strokeWidth="1.4" strokeDasharray="3 3" />
													<g fill="currentColor" fillOpacity="0.45" fontSize="7.5" fontFamily="inherit">
														<text x="120" y="16" textAnchor="middle">自然搜索</text>
														<text x="204" y="66" textAnchor="start">内容营销</text>
														<text x="176" y="146" textAnchor="middle">付费投放</text>
														<text x="64" y="146" textAnchor="middle">推荐</text>
														<text x="34" y="66" textAnchor="end">邮件</text>
														<text x="58" y="24" textAnchor="middle">社交</text>
													</g>
												</svg>
												<div className="chart-legend">
													<span>
														<i className="chart-legend__dot chart-legend__dot--on" />
														本季度
													</span>
													<span>
														<i className="chart-legend__dot" />
														上季度
													</span>
												</div>
											</div>
										</div>
									</div>
								</div>
							</div>

							<div className="duo__copy reveal">
								<p className="eyebrow">多形态回答</p>
								<h2 className="display display--sm">丰富的回答</h2>
								<p className="lede">
									Agent 的回答不必止于文字。同一条消息里可以嵌图、嵌表、嵌交互组件——形态随问题变化，表达完全由你定义。
								</p>
								<div className="kind-list">
									{ANSWER_KINDS.map((item, index) => (
										<button
											key={item.name}
											className={index === kind ? "kind-row is-active" : "kind-row"}
											type="button"
											onClick={() => setKind(index)}
										>
											<span className="kind-row__idx">{`0${index + 1}`}</span>
											<span className="kind-row__body">
												<span className="kind-row__head">
													<span className="kind-row__name">{item.name}</span>
													<span className="kind-row__tag">{item.tag}</span>
												</span>
												<span className="kind-row__desc">{item.desc}</span>
											</span>
										</button>
									))}
								</div>
							</div>
						</div>
					</section>

					<section className="band band--tight">
						<div className="wrap bulk">
							<div className="bulk__copy reveal">
								<p className="eyebrow">批量任务</p>
								<h2 className="display display--sm">上百个任务一次交给 Astravia，你只需等待</h2>
								<p className="lede">
									配置一次，让 AI 自动处理成百上千个文件夹与任务。Astravia 并行跑完整个队列、实时展示每个任务的运行与完成状态，把重复劳动从你手里拿走——剩下的只是等它跑完。
								</p>
								<div className="bulk__grid">
									{BULK_POINTS.map(([name, desc]) => (
										<div className="bulk__item" key={name}>
											<span className="bulk__name">{name}</span>
											<span className="bulk__desc">{desc}</span>
										</div>
									))}
								</div>
							</div>

							<div className="bulk__mock reveal">
								<div className="queue">
									<div className="queue__bar">
										<span className="queue__title">批量队列</span>
										<span className="queue__meta">128 个任务 · 3 并发</span>
									</div>
									<div className="queue__grid">
										{QUEUE.map(([name, state]) => (
											<span className={`queue-row is-${state}`} key={name}>
												{name}
												<span className="queue-row__state">
													{state === "done" ? "完成" : state === "run" ? "运行中" : "排队"}
												</span>
											</span>
										))}
									</div>
									<div className="queue__veil" aria-hidden="true" />
									<p className="queue__bubble">Summarize the relevant dynamics of 2026 from the project.</p>
									<div className="queue__foot">
										<span>已完成 84 · 运行中 3 · 排队 41</span>
										<span className="queue__pulse">实时</span>
									</div>
								</div>
							</div>
						</div>
					</section>

					<section className="band band--tight">
						<div className="wrap marketplace">
							<div className="marketplace__mock reveal">
								<div className="window">
									<div className="window__bar">
										<span className="window__dots">
											<i />
											<i />
											<i />
										</span>
										<span className="window__file">能力广场</span>
									</div>
									<div className="window__body">
										<div className="mkt-hero">
											<span className="mkt-hero__title">扩展 Astravia 的专业能力</span>
											<span className="mkt-hero__desc">按你想完成的事挑选，一键启用</span>
										</div>
										<div className="mkt-tools">
											<span className="mkt-tools__search">搜索能力</span>
											<span className="mkt-tools__btn">添加能力</span>
										</div>
										<ul className="mkt-list">
											{MARKET_ROWS.map(([ico, name, state]) => (
												<li className="mkt-row" key={name}>
													<span className="mkt-row__ico">{ico}</span>
													<span className="mkt-row__name">{name}</span>
													<span className="mkt-row__meta">{state}</span>
												</li>
											))}
										</ul>
									</div>
								</div>
							</div>

							<div className="marketplace__copy reveal">
								<p className="eyebrow">能力广场</p>
								<h2 className="display display--sm">官方插件、Skill 与 MCP，都在一个广场里</h2>
								<p className="lede">
									能力广场汇集了各式各样的 Skill 与 MCP：写作、表格、演示文稿、网页检索、语音合成……按需一键启用。它同时兼容你电脑里已有的通用 Agent Skill。
								</p>
								<ul className="bullet-list">
									{[
										["一个入口，按需启用", "按你想完成的事挑选能力，不必关心背后用的是什么技术"],
										["Skill 与 MCP 都能装", "官方能力、第三方 MCP 服务、自定义能力，统一在同一个列表里管理"],
										["兼容本机通用 Skill", "自动识别你电脑中已有的通用 Agent Skill，无需改写即可直接使用"],
										["零成本迁移", "沿用你已经习惯的工作方式，把工作偏好平滑迁到 Astravia"],
									].map(([title, desc]) => (
										<li key={title}>
											<span className="bullet-list__title">{title}</span>
											{desc}
										</li>
									))}
								</ul>
							</div>
						</div>
					</section>
				</>
			) : (
				<>
					<section className="band band--tight">
						<div className="wrap duo">
							<div className="duo__copy reveal">
								<p className="eyebrow">内置 Git</p>
								<h2 className="display display--sm">逐文件审查每一处改动</h2>
								<p className="lede">
									不必切回终端。Changes 视图按文件分组、逐行高亮增删，绿色新增、红色删除一目了然，配合行号锚点直接定位智能体改了什么、为什么改。
								</p>
								<ul className="tag-row">
									<li>Diff</li>
									<li>文件树</li>
									<li>行号锚点</li>
								</ul>
							</div>
							<div className="duo__media reveal">
								<div className="git-panel">
									<div className="git-panel__bar">
										<span className="git-panel__file">src/renderer/TabBar.tsx</span>
										<span className="git-panel__stat">+12 −4</span>
									</div>
									<ol className="diff">
										{[
											["ctx", "const active = tab.id === current;"],
											["del", "- return <div className=\"underline\" />;"],
											["add", "+ return <TabOutline active={active} />;"],
											["add", "+ // 指示器改由同一条 SVG 轮廓路径绘制"],
											["ctx", "}};"],
										].map(([kind, text], index) => (
											<li className={`diff__row diff__row--${kind}`} key={`${kind}-${index}`}>
												<span className="diff__num">{86 + index}</span>
												<span className="diff__text">{text}</span>
											</li>
										))}
									</ol>
									<div className="git-panel__foot">
										<span className="pill pill--ok">3 个文件已审阅</span>
										<span>测试通过 · 6 passed</span>
									</div>
								</div>
							</div>
						</div>
					</section>

					<section className="band band--tight">
						<div className="wrap plugin-eco">
							<SectionHead
								eyebrow="插件生态"
								title="一个可以被你重写的工作台"
								sub="插件不是几个配置开关，而是与宿主共享同一份运行时的一等扩展。往界面任意位置插入自己的面板、卡片和文件预览，注册工具、驾驶对话、聚合 MCP——全部由细粒度权限门控。"
							/>
							<div className="pillar-grid">
								{PILLARS.map(([ico, title, desc]) => (
									<article className="pillar reveal" key={title}>
										<span className="pillar__ico" aria-hidden="true">
											<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
												{ico === "layers" ? (
													<>
														<rect x="3" y="3" width="18" height="18" rx="2.4" />
														<path d="M3 9h18" />
														<path d="M9 21V9" />
													</>
												) : ico === "cycle" ? (
													<>
														<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
														<path d="M21 3v5h-5" />
														<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
														<path d="M3 21v-5h5" />
													</>
												) : ico === "stack" ? (
													<>
														<path d="m12 3 9 5-9 5-9-5 9-5Z" />
														<path d="m3 12 9 5 9-5" />
														<path d="m3 17 9 5 9-5" />
													</>
												) : (
													<>
														<rect x="4" y="10" width="16" height="11" rx="2.4" />
														<path d="M8 10V7a4 4 0 0 1 8 0v3" />
													</>
												)}
											</svg>
										</span>
										<h3 className="pillar__title">{title}</h3>
										<p className="pillar__desc">{desc}</p>
									</article>
								))}
							</div>
							<div className="code-split reveal">
								<div className="code-panel">
									<div className="code-panel__bar">
										<span className="window__dots">
											<i />
											<i />
											<i />
										</span>
										<span className="code-panel__file">plugin.ts</span>
									</div>
									<ol className="code-lines">
										{[
											["import", ' { definePlugin } ', "from", ' "@astravia-org/plugin-sdk";'],
										].map((row, index) => (
											<li key={index}>
												<span>
													<span className="tok-k">{row[0]}</span>
													{row[1]}
													<span className="tok-k">{row[2]}</span>
													<span className="tok-s">{row[3]}</span>
												</span>
											</li>
										))}
										<li><span /></li>
										<li><span><span className="tok-k">export default</span> definePlugin({"{"}</span></li>
										<li><span>  activate(ctx) {"{"}</span></li>
										<li><span>    ctx.ui.registerActivityTab({"{"}</span></li>
										<li><span>      id: <span className="tok-s">"my-tab"</span>,</span></li>
										<li><span>      label: <span className="tok-s">"我的面板"</span>,</span></li>
										<li><span>      component: MyPanel,</span></li>
										<li><span>    {"}"});</span></li>
										<li><span>  {"}"},</span></li>
										<li><span>{"}"});</span></li>
									</ol>
								</div>
								<div className="code-split__copy">
									<p className="eyebrow">为开发者而生</p>
									<h3 className="code-split__title">definePlugin + Vite + 共享 React 单例</h3>
									<p className="lede">同步调用、直接传组件、热更新调试，外加完整 SDK 与开发手册。插件写起来和写应用内页面没有区别。</p>
									<ul className="tag-row">
										<li>SDK</li>
										<li>热更新</li>
										<li>声明式贡献</li>
									</ul>
								</div>
							</div>
						</div>
					</section>
				</>
			)}

			<section className="band">
				<div className="wrap">
					<SectionHead
						center
						eyebrow="并行工作流"
						title="把大任务拆成可并行的子任务"
						sub="工作流将一次探索拆成多条并行轨道，每条都带进度、文件锚点引用与独立结论，最后汇总成可继续追问的答案。"
					/>

					<div className="workflow">
						<div className="workflow__pane reveal">
							<div className="workflow__bar">
								<span className="workflow__title">主会话</span>
								<span className="workflow__tag">3 条支线</span>
							</div>
							<div className="workflow__body">
								<div className="wf-row">
									<span className="wf-row__dot" />
									<span className="wf-row__text">沙箱能力在 desktop-app 与 coding-agent 里分别落在哪一层？</span>
								</div>
								{["desktop-app · 沙箱链路", "coding-agent · 沙箱链路", "runtime · 权限边界"].map((label) => (
									<div className="wf-row wf-row--tool" key={label}>
										<span className="wf-row__name">spawn_workflow</span>
										<code>{label}</code>
										<span className="pill pill--ok">完成</span>
									</div>
								))}
								<p className="wf-note">汇总结论：能力声明在宿主，执行隔离在 runtime，失败一律关闭。</p>
							</div>
						</div>
						<div className="workflow__pane reveal">
							<div className="workflow__bar">
								<span className="workflow__title">支线 · runtime 权限边界</span>
								<span className="workflow__tag">独立结论</span>
							</div>
							<div className="workflow__body workflow__body--doc">
								<p className="wf-h">工作区路径校验</p>
								<p className="wf-p">所有读写先解析为绝对路径，再判断是否落在工作区根目录下，越界直接拒绝。</p>
								<p className="wf-h">平台差异</p>
								<ul className="wf-list">
									<li>macOS：Seatbelt</li>
									<li>Linux：Bubblewrap</li>
									<li>Windows：sandbox host</li>
								</ul>
								<p className="wf-ref">packages/runtime-core/src/execution-mode/sandbox-tools.ts:88</p>
							</div>
						</div>
						<div className="workflow__note reveal">
							<span className="eyebrow">工作流是怎么跑起来的</span>
							<p className="workflow__note-title">任务明确，职责不同</p>
							<p className="workflow__note-desc">每条工作流只负责一件事，边界清楚：谁查沙箱、谁读协议、谁写结论，不重叠也不漏。</p>
						</div>
					</div>
				</div>
			</section>

			<section className="band band--tight">
				<div className="wrap clarify">
					<div className="clarify__copy reveal">
						<p className="eyebrow">主动澄清</p>
						<h2 className="display display--sm">遇到分叉，先问你，而不是瞎猜</h2>
						<p className="lede">
							当目标、范围或深度存在多种解读时，智能体不会替你默认，而是发起一个结构化的选择面板，把关键决策交还给你——减少返工，也让每一步都可控。
						</p>
						<ul className="bullet-list bullet-list--check">
							<li>分步提问：把一次复杂决策拆成目标、范围、深度等多个问题，逐步确认</li>
							<li>每个选项自带标题与说明，利弊权衡一眼看清，不必来回追问</li>
							<li>支持单选或多选，并始终保留「自定义输入」兜底，不被预设选项框死</li>
							<li>仅在存在多种合理解读时触发，确定性的步骤照常执行、不打断</li>
						</ul>
					</div>
					<div className="clarify__mock reveal">
						<div className="choice">
							<div className="choice__bar">
								<span className="choice__title">需要你确认</span>
								<span className="choice__step">1 / 3</span>
							</div>
							<div className="choice__breadcrumb">
								<span className="is-on">目标</span>
								<span>范围</span>
								<span>深度</span>
							</div>
							<p className="choice__q">这套沙箱设计接下来想先推到哪一步？</p>
							<ul className="choice__list">
								{CHOICES.map(([name, desc], index) => (
									<li className={index === 0 ? "choice-item is-on" : "choice-item"} key={name}>
										<span className="choice-item__radio" />
										<span className="choice-item__text">
											<span className="choice-item__name">{name}</span>
											<span className="choice-item__desc">{desc}</span>
										</span>
									</li>
								))}
							</ul>
							<div className="choice__foot">
								<span className="choice__cancel">取消</span>
								<span className="choice__next">下一步</span>
							</div>
						</div>
					</div>
				</div>
			</section>

			<section className="band">
				<div className="wrap">
					<SectionHead center eyebrow="更多能力" title="为日常工作与开发打造的完整工具箱" />
					<ul className="toolbox">
						{TOOLBOX.map(([name, desc]) => (
							<li className="tool-card reveal" key={name}>
								<span className="tool-card__name">{name}</span>
								<span className="tool-card__desc">{desc}</span>
							</li>
						))}
						<li className="tool-card reveal">
							<ExternalLink href="https://docs.astravia.dev" className="tool-card__link">
								<span className="tool-card__name">更多</span>
								<span className="tool-card__desc">还有更多，等你探索</span>
								<span className="tool-card__arrow" aria-hidden="true" />
							</ExternalLink>
						</li>
					</ul>

					<div className="feature-cta reveal">
						<p className="lede">对细节感兴趣？完整的能力说明、配置项与协议都在文档里。</p>
						<div className="feature-cta__actions">
							<Link to="/download" className="btn btn--solid">
								下载客户端
							</Link>
							<ExternalLink href="https://docs.astravia.dev" className="link-arrow">
								阅读文档
								<span>
									<Icon.Arrow />
								</span>
							</ExternalLink>
						</div>
					</div>
				</div>
			</section>
		</div>
	);
}