import type { ThemePageProps } from "@vetta-org/theme-sdk";
import { HorizontalSliceImageFrame, NineSliceImageDecoration, NineSliceImageFrame } from "@vetta-org/theme-ui";
import { cn } from "@vetta-org/ui";
import { motion } from "motion/react";
import type { JSX } from "react";
import {
	artifactCategories,
	artifactCultivationItems,
	artifactItems,
	featuredArtifacts,
	type ArtifactItem,
} from "./artifacts";
import { artifactLibraryAssets } from "./assets";

const panelDecoration = {
	borderWidth: "1.25rem",
	repeat: "stretch",
	slice: 72,
} as const;

const pillDecoration = {
	height: "100%",
	leftSlice: 180,
	leftWidth: "1.5rem",
	repeat: "stretch",
	rightSlice: 180,
	rightWidth: "1.5rem",
} as const;

export function XianxiaArtifactLibraryPage({ layout }: ThemePageProps): JSX.Element {
	return (
		<main
			className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-8 pb-8 pt-3 text-slate-900"
			data-theme-page-layout={layout}
		>
			<motion.div
				animate={{ opacity: 1, y: 0 }}
				className="mx-auto flex min-w-0 w-full max-w-[1180px] flex-col gap-5"
				initial={{ opacity: 0, y: 10 }}
				transition={{ duration: 0.45, ease: "easeOut" }}
			>
				<XianxiaArtifactHero />
				<XianxiaArtifactCategoryTabs />
				<section className="grid w-[80%] grid-cols-[repeat(2,minmax(0,1fr))] gap-4">
					{featuredArtifacts.map((artifact, index) => (
						<XianxiaFeaturedArtifactCard artifact={artifact} index={index} key={artifact.id} />
					))}
				</section>
				<section className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
					{artifactItems.map((artifact, index) => (
						<XianxiaArtifactCard artifact={artifact} index={index} key={artifact.id} />
					))}
				</section>
				<XianxiaArtifactCultivationPanel />
			</motion.div>
		</main>
	);
}

function XianxiaArtifactHero(): JSX.Element {
	return (
		<section className="relative overflow-visible px-8 py-8">
			<div className="relative z-10 max-w-[620px]">
				<p className="text-[16px] leading-5 text-slate-700">Tool Center</p>
				<h1 className="mt-2 text-[44px] font-semibold leading-none text-slate-950">
					法宝库 <span className="text-[30px] font-medium">· Artifact Library</span>
				</h1>
				<p className="mt-4 max-w-[520px] text-[17px] leading-7 text-slate-700">
					汇聚天地灵宝，助你事半功倍，沟通万象玄机。
				</p>
			</div>
		</section>
	);
}

function XianxiaArtifactCategoryTabs(): JSX.Element {
	return (
		<nav className="flex flex-wrap items-center gap-3" aria-label="Artifact categories">
			{artifactCategories.map((category, index) =>
				index === 0 ? (
					<HorizontalSliceImageFrame
						className="h-10 w-fit min-w-[86px] text-[14px] text-amber-200"
						contentClassName="relative z-10 flex h-full items-center justify-center px-4"
						decoration={pillDecoration}
						imageUrl={artifactLibraryAssets.pill}
						key={category}
					>
						<span className="whitespace-nowrap">{category}</span>
					</HorizontalSliceImageFrame>
				) : (
					<span
						className="flex h-10 items-center px-2 text-[14px] text-slate-800"
						key={category}
					>
						{category}
					</span>
				),
			)}
		</nav>
	);
}

function XianxiaFeaturedArtifactCard({
	artifact,
	index,
}: {
	readonly artifact: ArtifactItem;
	readonly index: number;
}): JSX.Element {
	const contentClassName = cn(
		"relative z-10 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-7 pt-6 pb-3",
		index === 1 && "grid-cols-[minmax(0,1fr)_5rem]",
	);
	const imageClassName = cn(
		"self-center justify-self-center w-auto max-w-none object-contain",
		index === 1 ? "pointer-events-none absolute right-0 -top-54 z-20 h-[280px]" : "h-[138px]",
	);

	return (
		<motion.article
			className="overflow-visible"
			animate={{ opacity: 1, y: 0 }}
			initial={{ opacity: 0, y: 12 }}
			transition={{ delay: 0.08 + index * 0.05, duration: 0.36, ease: "easeOut" }}
		>
			{index === 1 ? (
				<div className="relative h-full overflow-visible">
					<NineSliceImageDecoration
						className="[mask-image:linear-gradient(to_top_right,black_0%,black_42%,transparent_60%,transparent_100%)] [mask-repeat:no-repeat] [mask-size:100%_100%]"
						decoration={panelDecoration}
						imageUrl={artifactLibraryAssets.panel}
					/>
					<motion.img
						alt=""
						aria-hidden="true"
						animate={{ opacity: 1, x: 0 }}
						className="pointer-events-none absolute -right-80 -top-[310px] z-[1] h-[590px] w-auto max-w-none object-contain"
						initial={{ opacity: 0, x: 18 }}
						src={artifactLibraryAssets.character}
						transition={{ delay: 0.1, duration: 0.55, ease: "easeOut" }}
					/>
					<div className={contentClassName}>
						<ArtifactCardText artifact={artifact} prominent />
						<div aria-hidden="true" className="h-[138px] w-20" />
						<img
							alt=""
							aria-hidden="true"
							className={imageClassName}
							src={artifact.imageUrl}
						/>
					</div>
				</div>
			) : (
				<NineSliceImageFrame
					className="h-full overflow-visible"
					contentClassName={contentClassName}
					decoration={panelDecoration}
					imageUrl={artifactLibraryAssets.panel}
				>
					<ArtifactCardText artifact={artifact} prominent />
					<img
						alt=""
						aria-hidden="true"
						className={imageClassName}
						src={artifact.imageUrl}
					/>
				</NineSliceImageFrame>
			)}
		</motion.article>
	);
}

function XianxiaArtifactCard({
	artifact,
	index,
}: {
	readonly artifact: ArtifactItem;
	readonly index: number;
}): JSX.Element {
	return (
		<motion.article
			animate={{ opacity: 1, y: 0 }}
			initial={{ opacity: 0, y: 12 }}
			transition={{ delay: 0.16 + index * 0.04, duration: 0.32, ease: "easeOut" }}
			whileHover={{ y: -2 }}
		>
			<NineSliceImageFrame
				className="h-full"
				contentClassName="relative z-10 grid grid-cols-[minmax(0,1fr)_128px] gap-3 px-6 pt-4.5 pb-2"
				decoration={panelDecoration}
				imageUrl={artifactLibraryAssets.panel}
			>
				<ArtifactCardText artifact={artifact} />
				<img
					alt=""
					aria-hidden="true"
					className="self-center justify-self-center h-[136px] w-auto max-w-none object-contain"
					src={artifact.imageUrl}
				/>
			</NineSliceImageFrame>
		</motion.article>
	);
}

function ArtifactCardText({
	artifact,
	prominent = false,
}: {
	readonly artifact: ArtifactItem;
	readonly prominent?: boolean;
}): JSX.Element {
	return (
		<div className="flex min-w-0 flex-col">
			<div className="flex items-center gap-2">
				<h2 className={cn("truncate text-slate-950", prominent ? "text-[24px]" : "text-[21px]")}>
					{artifact.name}
				</h2>
			</div>
			<p className="text-[12px] text-slate-600">{artifact.category}</p>
			<p className="line-clamp-3 text-[13px] leading-5 text-slate-700">{artifact.description}</p>
			<div className="mt-auto">
				<div className="flex items-center mt-1 gap-3 text-[12px] text-slate-700">
					<span>熟练度</span>
					<span>{artifact.level}%</span>
				</div>
				<div className="flex items-center gap-3">
					<div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-300/65">
						<motion.div
							animate={{ width: `${artifact.level}%` }}
							className="h-full rounded-full bg-slate-700/65"
							initial={{ width: "0%" }}
							transition={{ delay: 0.35, duration: 0.65, ease: "easeOut" }}
						/>
					</div>
					<span className="icon-[solar--arrow-right-linear] h-5 w-5 rounded-full bg-white/50 p-1 text-slate-700" />
				</div>
			</div>
		</div>
	);
}

function XianxiaArtifactCultivationPanel(): JSX.Element {
	return (
		<NineSliceImageFrame
			className="mb-1"
			contentClassName="relative z-10 grid min-h-[112px] grid-cols-1 items-center gap-5 px-7 py-5 lg:grid-cols-[minmax(220px,1fr)_repeat(3,minmax(150px,220px))]"
			decoration={panelDecoration}
			imageUrl={artifactLibraryAssets.panel}
		>
			<div>
				<h2 className="text-[24px] font-semibold text-slate-950">法宝养成</h2>
				<p className="mt-1 text-[14px] leading-5 text-slate-700">持续使用法宝可提升熟练度，解锁更强效果与专属能力。</p>
				<p className="mt-2 text-[13px] font-semibold text-slate-700">养成指南 →</p>
			</div>
			{artifactCultivationItems.map((item) => (
				<div className="flex min-w-0 items-center gap-3 border-l border-slate-400/40 pl-5" key={item.title}>
					<span className={cn(item.icon, "h-9 w-9 flex-none text-slate-700")} />
					<div className="min-w-0">
						<h3 className="truncate text-[16px] font-semibold text-slate-800">{item.title}</h3>
						<p className="mt-1 truncate text-[13px] text-slate-600">{item.description}</p>
					</div>
				</div>
			))}
		</NineSliceImageFrame>
	);
}
