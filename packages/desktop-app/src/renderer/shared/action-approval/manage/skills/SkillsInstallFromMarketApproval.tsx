import { useState } from "react";
import { Input } from "../../../components/ui/input";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalFormField,
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input {
	operation: "install-from-market";
	type: "skill" | "scene";
	slug: string;
	approvalUi?: string;
}

export function parseSkillsInstallFromMarketInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "install-from-market") return null;
	if (r.type !== "skill" && r.type !== "scene") return null;
	if (typeof r.slug !== "string" || r.slug.trim().length === 0) return null;
	return {
		operation: "install-from-market",
		type: r.type,
		slug: r.slug.trim(),
		approvalUi: typeof r.approvalUi === "string" ? r.approvalUi : undefined,
	};
}

export function SkillsInstallFromMarketApproval(): JSX.Element | null {
	const approval = useActionApproval("skills.install-from-market");
	if (!approval) return null;
	return <Content key={approval.request.approvalId} approval={approval} />;
}

function Content({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const parsed = parseSkillsInstallFromMarketInput(request.input);
	const [slug, setSlug] = useState(parsed?.slug ?? "");
	const [type, setType] = useState<"skill" | "scene">(parsed?.type ?? "skill");

	return (
		<Frame
			presentation="drawer"
			title={t("manageApproval.skills.ops.install-from-market.title")}
			summary={t("manageApproval.skills.ops.install-from-market.summary")}
			icon="icon-[mdi--puzzle-plus-outline]"
			badge={t("manageApproval.skills.ops.install-from-market.badge")}
			labels={frameLabels(request.permission, t("manageApproval.skills.ops.install-from-market.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => {
				if (!parsed) {
					approve();
					return;
				}
				approve({
					operation: "install-from-market",
					type,
					slug: slug.trim(),
					approvalUi: parsed.approvalUi ?? "skills.install-from-market",
				});
			}}
			canApprove={Boolean(parsed) && slug.trim().length > 0}
		>
			{parsed ? (
				<>
					<ApprovalTargetCard
						icon="icon-[mdi--store-outline]"
						title={slug || parsed.slug}
						subtitle={t("manageApproval.fields.abilitySlug")}
						badge={type === "scene" ? t("manageApproval.fields.scene") : t("manageApproval.fields.skill")}
					/>
					<ApprovalFormField id="skills-install-type" label={t("manageApproval.fields.resourceType")}>
						<select
							id="skills-install-type"
							className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
							value={type}
							onChange={(event) => setType(event.target.value === "scene" ? "scene" : "skill")}
						>
							<option value="skill">{t("manageApproval.fields.skill")}</option>
							<option value="scene">{t("manageApproval.fields.scene")}</option>
						</select>
					</ApprovalFormField>
					<ApprovalFormField id="skills-install-slug" label={t("manageApproval.fields.abilitySlug")}>
						<Input id="skills-install-slug" value={slug} onChange={(event) => setSlug(event.target.value)} />
					</ApprovalFormField>
					<ApprovalImpactCard
						icon="icon-[mdi--puzzle-plus-outline]"
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.skills.ops.install-from-market.impact")}
					/>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
