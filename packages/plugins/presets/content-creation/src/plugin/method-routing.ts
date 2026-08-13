import creativeConceptSkill from "../../agent/skills/develop-creative-concept/SKILL.md?raw";
import imageCreationSkill from "../../agent/skills/direct-image-creation/SKILL.md?raw";
import imageModelProfiles from "../../agent/skills/direct-image-creation/references/model-prompt-profiles.md?raw";
import imagePromptFramework from "../../agent/skills/direct-image-creation/references/prompt-framework.md?raw";
import imageQualityChecklist from "../../agent/skills/direct-image-creation/references/quality-checklist.md?raw";
import videoCreationSkill from "../../agent/skills/direct-video-creation/SKILL.md?raw";
import animateStillMethod from "../../agent/skills/direct-video-creation/references/animate-still-method.md?raw";
import videoContinuity from "../../agent/skills/direct-video-creation/references/continuity-and-references.md?raw";
import videoDramaturgy from "../../agent/skills/direct-video-creation/references/dramaturgy-and-shot-design.md?raw";
import firstLastFrameMethod from "../../agent/skills/direct-video-creation/references/first-last-frame-method.md?raw";
import videoModelProfiles from "../../agent/skills/direct-video-creation/references/model-prompt-profiles.md?raw";
import omniReferenceMethod from "../../agent/skills/direct-video-creation/references/omni-reference-method.md?raw";
import productVideoRecipes from "../../agent/skills/direct-video-creation/references/product-brand-and-logo-video-recipes.md?raw";
import videoReferenceDirecting from "../../agent/skills/direct-video-creation/references/reference-role-and-timed-directing.md?raw";
import videoPrompting from "../../agent/skills/direct-video-creation/references/prompting.md?raw";
import videoQualityChecklist from "../../agent/skills/direct-video-creation/references/quality-checklist.md?raw";
import textToVideoMethod from "../../agent/skills/direct-video-creation/references/text-to-video-method.md?raw";
import transformVideoMethod from "../../agent/skills/direct-video-creation/references/transform-video-method.md?raw";
import videoEditing from "../../agent/skills/direct-video-creation/references/video-editing-and-extension.md?raw";
import videoStrategySelection from "../../agent/skills/direct-video-creation/references/video-strategy-selection.md?raw";
import workflowSkill from "../../agent/skills/operate-content-workflow/SKILL.md?raw";
import operationContract from "../../agent/skills/operate-content-workflow/references/operation-contract.md?raw";
import qualityReviewSkill from "../../agent/skills/review-content-quality/SKILL.md?raw";
import { VIDEO_PROMPT_PLAN_FIELD_GUIDANCE } from "../agent/generation-prompt-plan";

export type ContentMethodId =
	| "operate-content-workflow"
	| "develop-creative-concept"
	| "direct-image-creation"
	| "direct-video-creation"
	| "video-text-to-video-method"
	| "video-animate-still-method"
	| "video-first-last-frame-method"
	| "video-omni-reference-method"
	| "video-transform-method"
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
		{ id: "direct-video-creation/video-strategy-selection.md", content: videoStrategySelection },
		{ id: "direct-video-creation/dramaturgy-and-shot-design.md", content: videoDramaturgy },
		{ id: "direct-video-creation/prompting.md", content: videoPrompting },
		{ id: "direct-video-creation/model-prompt-profiles.md", content: videoModelProfiles },
		{ id: "direct-video-creation/quality-checklist.md", content: videoQualityChecklist },
	],
	"video-text-to-video-method": [
		{ id: "direct-video-creation/text-to-video-method.md", content: textToVideoMethod },
	],
	"video-animate-still-method": [
		{ id: "direct-video-creation/animate-still-method.md", content: animateStillMethod },
	],
	"video-first-last-frame-method": [
		{ id: "direct-video-creation/first-last-frame-method.md", content: firstLastFrameMethod },
		{ id: "direct-video-creation/continuity-and-references.md", content: videoContinuity },
		{ id: "direct-video-creation/reference-role-and-timed-directing.md", content: videoReferenceDirecting },
	],
	"video-omni-reference-method": [
		{ id: "direct-video-creation/omni-reference-method.md", content: omniReferenceMethod },
		{ id: "direct-video-creation/reference-role-and-timed-directing.md", content: videoReferenceDirecting },
	],
	"video-transform-method": [
		{ id: "direct-video-creation/transform-video-method.md", content: transformVideoMethod },
		{ id: "direct-video-creation/video-editing-and-extension.md", content: videoEditing },
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
const TEXT_TO_VIDEO_PATTERN =
	/\b(text.?to.?video|from (?:a )?(?:prompt|description|text))\b|文生视频|文字生成视频|从(?:文字|描述|提示词)生成视频/i;
const ANIMATE_STILL_PATTERN =
	/\b(image.?to.?video|animate (?:an? )?(?:image|photo|still)|source (?:image|photo)|product (?:image|photo))\b|图生视频|单图动画|图片动起来|照片动起来|主图|产品图|商品图|参考图.{0,8}(?:生成|制作).{0,8}视频/i;
const OMNI_REFERENCE_PATTERN =
	/\b(omni.?reference|multi.?reference|multiple references|all.?purpose reference|reference.?guided)\b|全能参考|多参考|多个参考|多素材参考|图一|图二|场景参考/i;
const TRANSFORM_VIDEO_PATTERN =
	/\b(video.?to.?video|transform video|video (?:edit|extension|continuation)|motion transfer|restyle)\b|视频转换|视频编辑|视频续写|视频延长|视频替换|动作迁移|风格转换/i;
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
	if (wantsVideo) {
		methods.push("direct-video-creation");
		if (TEXT_TO_VIDEO_PATTERN.test(text)) methods.push("video-text-to-video-method");
		if (ANIMATE_STILL_PATTERN.test(text) && !KEYFRAME_CONTROL_PATTERN.test(text)) {
			methods.push("video-animate-still-method");
		}
		if (KEYFRAME_CONTROL_PATTERN.test(text)) methods.push("video-first-last-frame-method");
		if (OMNI_REFERENCE_PATTERN.test(text)) methods.push("video-omni-reference-method");
		if (TRANSFORM_VIDEO_PATTERN.test(text)) methods.push("video-transform-method");
	}
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
		"For every Agent-authored video prompt, submit the strategy-specific promptPlan kind instead of an unstructured or generic video-shot prompt.",
		"Prefer configure_video_shot over low-level configure_generation. Declare exact opening/ending and scene-reference requirements so the host selects first/last-frame or omni-reference control without degrading to animate-still.",
		"Even with strategy=automatic, choose the prompt plan kind that represents the intended creative method. The host rejects a plan/strategy mismatch.",
		"For connect_nodes use sourceNodeId, targetNodeId, and optional edgeId. Never duplicate a configure_video_shot media source with connect_nodes, and never send low-level role inside high-level sources.",
		"exactEnding means a hard last-frame image anchor and requires both keyframes; a stable final composition belongs in promptPlan.finalState with exactEnding false.",
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
