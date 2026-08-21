import { CULTIVATION_REALMS } from "../../cultivation";
import type { SanctumAchievement } from "./achievements";
import type {
	RealmDetailAction,
	RealmDetailOutcome,
	RealmDetailView,
	RealmProgressItem,
	SanctumCultivationView,
} from "./types";

const REALM_DETAIL_ACTIONS = [
	{ icon: "icon-[solar--chat-round-dots-bold]", label: "开始对话", target: { kind: "chat" } },
	{ icon: "icon-[solar--book-2-bold]", label: "去知识库", target: { kind: "knowledgeBase" } },
	{ icon: "icon-[solar--play-circle-bold]", label: "批量任务", target: { kind: "batchTasks" } },
	{ icon: "icon-[solar--settings-bold]", label: "去自动化", target: { kind: "automation" } },
] as const satisfies readonly RealmDetailAction[];

const REALM_DETAIL_SOURCES = ["对话与会话", "活跃与项目", "工具与知识库", "批处理与自动化"] as const;

interface RealmScoreCategory {
	readonly icon: string;
	readonly label: string;
	readonly targetWeight: number;
	readonly value: number;
}

export function getRealmDetailView(
	achievement: SanctumAchievement,
	cultivation: SanctumCultivationView,
): RealmDetailView {
	const realmIndex = Math.max(
		0,
		CULTIVATION_REALMS.findIndex((realm) => realm.id === achievement.id),
	);
	const realm = CULTIVATION_REALMS[realmIndex] ?? CULTIVATION_REALMS[0];
	const previousRealm = CULTIVATION_REALMS[realmIndex - 1] ?? null;
	const nextRealm = CULTIVATION_REALMS[realmIndex + 1] ?? null;
	const achieved = cultivation.achievedRealmIds.includes(achievement.id);
	const remainingScore = Math.max(0, realm.targetScore - cultivation.score);
	const categories = getRealmScoreCategories(cultivation);
	const primaryCategory = categories.reduce((primary, category) =>
		category.value > primary.value ? category : primary,
	);

	return {
		achieved,
		achievement,
		actions: REALM_DETAIL_ACTIONS,
		benefits: getRealmBenefits(achievement, realm.targetScore, nextRealm?.name ?? null),
		definition: getRealmDefinition(
			achievement.name,
			achieved,
			cultivation.score,
			realm.targetScore,
			remainingScore,
		),
		nextRealmName: nextRealm?.name ?? null,
		previousRealmName: previousRealm?.name ?? null,
		requirements: getRealmProgressItems(cultivation, realm.targetScore, categories),
		rewards: getRealmRewards(achievement, primaryCategory),
		sources: REALM_DETAIL_SOURCES,
	};
}

function getRealmScoreCategories(cultivation: SanctumCultivationView): readonly RealmScoreCategory[] {
	const breakdown = cultivation.scoreBreakdown;
	return [
		{
			icon: "icon-[solar--chat-round-dots-bold]",
			label: "对话修为",
			targetWeight: 0.4,
			value: breakdown.messages + breakdown.turns + breakdown.depth,
		},
		{
			icon: "icon-[solar--book-2-bold]",
			label: "工具知识",
			targetWeight: 0.25,
			value: breakdown.tools + breakdown.knowledge,
		},
		{
			icon: "icon-[solar--settings-bold]",
			label: "实践自动化",
			targetWeight: 0.35,
			value:
				breakdown.activeTime +
				breakdown.sessions +
				breakdown.tokens +
				breakdown.projects +
				breakdown.batch +
				breakdown.automation +
				breakdown.streak,
		},
	];
}

function getRealmProgressItems(
	cultivation: SanctumCultivationView,
	targetScore: number,
	categories: readonly RealmScoreCategory[],
): readonly RealmProgressItem[] {
	const realmProgress = targetScore <= 0 ? 1 : cultivation.score / targetScore;

	return [
		{
			icon: "icon-[solar--medal-ribbon-star-bold]",
			label: "境界进度",
			progress: clamp01(realmProgress),
			valueText: targetScore <= 0 ? "已达成" : `${Math.round(clamp01(realmProgress) * 100)}%`,
		},
		...categories.map((category) => {
			if (targetScore <= 0) {
				return {
					icon: category.icon,
					label: category.label,
					progress: 1,
					valueText: "起点",
				};
			}
			const categoryTarget = Math.max(1, Math.ceil(targetScore * category.targetWeight));
			const complete = category.value >= categoryTarget;
			return {
				icon: category.icon,
				label: category.label,
				progress: complete ? 1 : clamp01(category.value / categoryTarget),
				valueText: complete ? "100%" : formatProgressValue(category.value, categoryTarget),
			};
		}),
	];
}

function getRealmDefinition(
	realmName: string,
	achieved: boolean,
	currentScore: number,
	targetScore: number,
	remainingScore: number,
): string {
	if (targetScore <= 0) {
		return `${realmName}是修行起点。当前累计修为 ${formatNumber(currentScore)}，已具备该境界资格。`;
	}
	if (achieved) {
		return `${realmName}的突破门槛为 ${formatNumber(targetScore)} 修为。当前累计 ${formatNumber(currentScore)} 修为，已经达到该境界。`;
	}
	return `${realmName}的突破门槛为 ${formatNumber(targetScore)} 修为。当前累计 ${formatNumber(currentScore)} 修为，仍需 ${formatNumber(remainingScore)} 修为。`;
}

function getRealmBenefits(
	achievement: SanctumAchievement,
	targetScore: number,
	nextRealmName: string | null,
): readonly RealmDetailOutcome[] {
	return [
		{
			icon: "icon-[solar--chart-2-bold]",
			label: targetScore <= 0 ? "初始境界" : `${formatCompactNumber(targetScore)} 修为门槛`,
		},
		{ icon: "icon-[solar--medal-ribbon-star-bold]", label: `点亮${achievement.name}` },
		{
			icon: "icon-[solar--branching-paths-up-bold]",
			label: nextRealmName ? `开启${nextRealmName}进阶` : "登临最高境界",
		},
	];
}

function getRealmRewards(
	achievement: SanctumAchievement,
	primaryCategory: RealmScoreCategory,
): readonly RealmDetailOutcome[] {
	return [
		{ icon: "icon-[solar--medal-ribbon-star-bold]", label: `${achievement.name}徽章` },
		{ icon: "icon-[solar--ranking-bold]", label: `第 ${achievement.level} 阶称号` },
		{
			icon: "icon-[solar--chart-2-bold]",
			label: primaryCategory.value > 0 ? `主修${primaryCategory.label}` : "等待修行积累",
		},
	];
}

function formatNumber(value: number): string {
	return Math.max(0, Math.floor(value)).toLocaleString("zh-CN");
}

function formatCompactNumber(value: number): string {
	return new Intl.NumberFormat("zh-CN", {
		maximumFractionDigits: 1,
		notation: "compact",
	}).format(Math.max(0, Math.floor(value)));
}

function formatProgressValue(value: number, target: number): string {
	const scale = target >= 10_000 ? 10_000 : target >= 1_000 ? 1_000 : 1;
	const suffix = scale === 10_000 ? "万" : scale === 1_000 ? "k" : "";
	return `${formatScaledNumber(value, scale)}/${formatScaledNumber(target, scale)}${suffix}`;
}

function formatScaledNumber(value: number, scale: number): string {
	if (scale === 1) return Math.max(0, Math.floor(value)).toString();
	const scaled = Math.max(0, value) / scale;
	return (Math.round(scaled * 10) / 10).toString();
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}
