import creativeConceptSkill from "../../agent/skills/develop-creative-concept/SKILL.md?raw";
import imageCreationSkill from "../../agent/skills/direct-image-creation/SKILL.md?raw";
import imageModelProfiles from "../../agent/skills/direct-image-creation/references/model-prompt-profiles.md?raw";
import imagePromptFramework from "../../agent/skills/direct-image-creation/references/prompt-framework.md?raw";
import imageQualityChecklist from "../../agent/skills/direct-image-creation/references/quality-checklist.md?raw";
import videoCreationSkill from "../../agent/skills/direct-video-creation/SKILL.md?raw";
import videoContinuity from "../../agent/skills/direct-video-creation/references/continuity-and-references.md?raw";
import videoDramaturgy from "../../agent/skills/direct-video-creation/references/dramaturgy-and-shot-design.md?raw";
import videoModelProfiles from "../../agent/skills/direct-video-creation/references/model-prompt-profiles.md?raw";
import productVideoRecipes from "../../agent/skills/direct-video-creation/references/product-brand-and-logo-video-recipes.md?raw";
import videoReferenceDirecting from "../../agent/skills/direct-video-creation/references/reference-role-and-timed-directing.md?raw";
import videoPrompting from "../../agent/skills/direct-video-creation/references/prompting.md?raw";
import videoPromptSkeletons from "../../agent/skills/direct-video-creation/references/production-prompt-skeletons.md?raw";
import videoQualityChecklist from "../../agent/skills/direct-video-creation/references/quality-checklist.md?raw";
import workflowSkill from "../../agent/skills/operate-content-workflow/SKILL.md?raw";
import operationContract from "../../agent/skills/operate-content-workflow/references/operation-contract.md?raw";
import qualityReviewSkill from "../../agent/skills/review-content-quality/SKILL.md?raw";
import { VIDEO_PROMPT_PLAN_FIELD_GUIDANCE } from "../agent/generation-prompt-plan";

export type ContentMethodId =
	| "operate-content-workflow"
	| "develop-creative-concept"
	| "direct-image-creation"
	| "direct-video-creation"
	| "product-video-recipe"
	| "review-content-quality";

interface ContentMethodResource {
	id: string;
	content: string;
}

const METHOD_RESOURCES: Readonly<Record<ContentMethodId, readonly ContentMethodResource[]>> = {
	"operate-content-workflow": [
		{ id: "operate-content-workflow/SKILL.md", content: workflowSkill },
		{ id: "operate-content-workflow/operation-contract.md", content: operationContract },
	],
	"develop-creative-concept": [
		{ id: "develop-creative-concept/SKILL.md", content: creativeConceptSkill },
	],
	"direct-image-creation": [
		{ id: "direct-image-creation/SKILL.md", content: imageCreationSkill },
		{ id: "direct-image-creation/prompt-framework.md", content: imagePromptFramework },
		{ id: "direct-image-creation/model-prompt-profiles.md", content: imageModelProfiles },
		{ id: "direct-image-creation/quality-checklist.md", content: imageQualityChecklist },
	],
	"direct-video-creation": [
		{ id: "direct-video-creation/SKILL.md", content: videoCreationSkill },
		{ id: "direct-video-creation/continuity-and-references.md", content: videoContinuity },
		{ id: "direct-video-creation/dramaturgy-and-shot-design.md", content: videoDramaturgy },
		{ id: "direct-video-creation/prompting.md", content: videoPrompting },
		{ id: "direct-video-creation/model-prompt-profiles.md", content: videoModelProfiles },
		{ id: "direct-video-creation/production-prompt-skeletons.md", content: videoPromptSkeletons },
		{ id: "direct-video-creation/reference-role-and-timed-directing.md", content: videoReferenceDirecting },
		{ id: "direct-video-creation/quality-checklist.md", content: videoQualityChecklist },
	],
	"product-video-recipe": [
		{ id: "direct-video-creation/product-brand-and-logo-video-recipes.md", content: productVideoRecipes },
	],
	"review-content-quality": [
		{ id: "review-content-quality/SKILL.md", content: qualityReviewSkill },
	],
};

const CONTENT_PATTERN =
	/\b(content|creative|workflow|canvas|image|photo|poster|video|film|shot|campaign|asset|prompt)\b|内容|创作|工作流|画布|图片|图像|照片|海报|主视觉|视频|影片|镜头|广告|素材|提示词|生成/i;
const VIDEO_PATTERN =
	/\b(video|film|shot|clip|camera|storyboard|animate|motion)\b|视频|影片|镜头|运镜|分镜|动画|动态|首帧|尾帧|首尾帧/i;
const KEYFRAME_CONTROL_PATTERN =
	/\b(first.?frame|last.?frame|start.?frame|end.?frame|exact (?:opening|ending)|loop)\b|首帧|尾帧|首尾帧|精准(?:开场|结尾|落点)|精确(?:开场|结尾|落点)|循环/i;
const IMAGE_CREATION_PATTERN =
	/\b(generate|create|design|make).{0,24}\b(image|photo|poster|visual)\b|(?:生成|创建|制作|设计).{0,12}(?:图片|图像|照片|海报|主视觉)|(?:图片|图像|照片|海报|主视觉).{0,12}(?:生成|创建|制作|设计)/i;
const PRODUCT_PATTERN =
	/\b(product|brand|logo|jewelry|commercial|advertisement|ad)\b|产品|商品|品牌|标志|珠宝|首饰|商业广告|广告片/i;
const CONCEPT_PATTERN =
	/\b(concept|idea|direction|treatment|brainstorm)\b|概念|创意方向|方案|构思|脑暴/i;
const REVIEW_PATTERN =
	/\b(review|critique|quality|weak|broken|improve|audit)\b|审查|评审|质量|不好|很差|改进|优化|审核/i;

export function selectContentMethodIds(text: string): ContentMethodId[] {
	if (!CONTENT_PATTERN.test(text)) return [];
	const methods: ContentMethodId[] = ["operate-content-workflow"];
	const wantsVideo = VIDEO_PATTERN.test(text);
	if (CONCEPT_PATTERN.test(text)) methods.push("develop-creative-concept");
	if (IMAGE_CREATION_PATTERN.test(text) && !wantsVideo) methods.push("direct-image-creation");
	if (wantsVideo && KEYFRAME_CONTROL_PATTERN.test(text)) methods.push("direct-image-creation");
	if (wantsVideo) methods.push("direct-video-creation");
	if (wantsVideo && PRODUCT_PATTERN.test(text)) methods.push("product-video-recipe");
	if (REVIEW_PATTERN.test(text)) methods.push("review-content-quality");
	return methods;
}

export function renderContentMethodContext(methodIds: readonly ContentMethodId[]): string {
	const resources = methodIds
		.flatMap((methodId) => METHOD_RESOURCES[methodId])
		.filter((resource, index, all) => all.findIndex((candidate) => candidate.id === resource.id) === index);
	if (resources.length === 0) return "";
	return [
		"# Required content-creation method bundle",
		"",
		`The host deterministically selected these methods for the current request: ${methodIds.join(", ")}.`,
		"Apply this loaded guidance before calling content_creation_edit. Do not bypass it with a generic prompt.",
		"For every Agent-authored video prompt, submit promptPlan instead of an unstructured prompt.",
		"Prefer configure_video_shot over low-level configure_generation. Declare exact opening/ending and scene-reference requirements so the host selects first/last-frame or omni-reference control without degrading to animate-still.",
		"Image keyframe plans describe frozen visible states; video plans describe continuous state change. Never reuse one prompt across those node kinds.",
		`promptPlan fields: ${VIDEO_PROMPT_PLAN_FIELD_GUIDANCE}.`,
		"The plugin compiles the plan and rejects effective video prompt changes that omit the production method.",
		"If invoke_skill is available, its normal invocation requirement still applies; this bundle guarantees the method content is present even when invocation routing is missed.",
		...resources.flatMap((resource) => [
			"",
			`<content_method_resource id="${resource.id}">`,
			resource.content.trim(),
			"</content_method_resource>",
		]),
	].join("\n");
}
