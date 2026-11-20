import { Icon, Link, ExternalLink } from "../app/ui";

/** 关于页：参考站的排版是「标题段 + 四个编号长文段 + 收尾 CTA」，全文字，不放插图。 */
const SECTIONS = [
	{
		num: "01",
		title: "Astravia 从哪里开始",
		paras: [
			"Astravia 的第一个可用版本诞生于 2026 年初，起点是一线团队的真实需求：在企业私有化环境里，模型和算力都在本地，任务却复杂、连续、难以标准化。",
			"只靠一次问答或一段脚本解决不了这类问题。团队把注意力放在 Agent Loop 上——工具调用、上下文管理、长任务持续运行、过程可观测、失败可回滚，这些才是让智能体真正干完活的部件。",
			"这些能力后来被整理成一套桌面工作台，也就是你现在看到的 Astravia。",
		],
	},
	{
		num: "02",
		title: "Astravia 是什么",
		paras: [
			"Astravia 是一个为真实工作而生的开源 AI Agent。它面向工作与编程场景，帮助个人与企业构建可定制、可扩展、可掌控的智能体。",
			"处理文档、分析数据、写代码、搭工作流，或者连接企业内部的模型、工具与知识——这些事都发生在同一个窗口里，会话、文件与产出留在同一份工作区记录中。",
			"它可以跑在你指定的环境：连接自己的模型与端点，也可以离线运行。数据默认留在本机，没有遥测，也没有账号体系。",
		],
	},
	{
		num: "03",
		title: "为什么选择开源",
		paras: [
			"我们选择开源，因为 AI 的工作方式不该由少数人单独定义。",
			"Astravia 希望成为一个由开发者、创作者与真实用户共同建设的平台：贡献代码、编写技能、接入新的模型与工具、改进产品体验，或者只是把你在真实场景里的用法讲出来。",
			"真正有生命力的 AI 产品应当是开放的、可扩展的，并且能随着社区与真实需求持续成长。Apache-2.0 许可是这个承诺的一部分。",
		],
	},
	{
		num: "04",
		title: "我们要去的地方",
		paras: [
			"AI 正在改变每个人和每家企业的工作方式，但通用助手离「懂你的工作」还有距离。",
			"Astravia 想缩短这段距离：让每个用户、每家企业都能更快拥有贴合自身需求的 Agent——它理解你的工作方式，连接你的数据与工具，并始终运行在你可以掌控的边界之内。",
			"千人千个 Agent。这条路我们想和用户、开发者与企业一起走完。",
		],
	},
];

export function AboutPage() {
	return (
		<>
			<section className="about-hero">
				<div className="hero__grid" aria-hidden="true" />
				<div className="page-hero__glow" aria-hidden="true" />
				<div className="wrap about-hero__inner">
					<p className="eyebrow reveal">关于 Astravia</p>
					<h1 className="display about-hero__title reveal">为真实工作而生的 AI Agent</h1>
					<p className="about-hero__sub reveal">
						我们相信，好的智能体不该只是一个聊天框。它应该能读你的文件、跑你的项目、交付可检查的结果，并且始终留在你能掌控的边界里。
					</p>
					<div className="about-hero__actions reveal">
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
				</div>
			</section>

			<section className="about-story">
				<div className="wrap">
					{SECTIONS.map((section) => (
						<article className="story-block reveal" key={section.num}>
							<span className="story-block__num">{section.num}</span>
							<div className="story-block__body">
								<h2 className="story-block__title">{section.title}</h2>
								{section.paras.map((para) => (
									<p className="story-block__para" key={para.slice(0, 12)}>
										{para}
									</p>
								))}
							</div>
						</article>
					))}
				</div>
			</section>

			<section className="close-band">
				<div className="closer__glow" aria-hidden="true" />
				<div className="wrap close-band__inner">
					<h2 className="display display--md reveal">从真实工作开始。</h2>
					<p className="lede reveal">下载客户端，在自己的环境里体验 Astravia；或直接与我们联系，聊聊你的场景。</p>
					<div className="close-band__actions reveal">
						<Link to="/download" className="btn btn--solid btn--lg">
							下载客户端
						</Link>
						<ExternalLink href="https://github.com/maomaochong-ai/astravia/issues/new" className="link-arrow">
							联系我们
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
