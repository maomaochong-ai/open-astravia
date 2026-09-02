import { Fragment, type JSX, type ReactNode } from "react";
import type { ComposerComposition } from "./capabilities";

export interface ComposerCapabilityRegionProps<TRegion extends string> {
	readonly composition: ComposerComposition<TRegion, ReactNode>;
	readonly region: TRegion;
}

/** Renders all installed capability contributions for one semantic layout anchor. */
export function ComposerCapabilityRegion<TRegion extends string>({
	composition,
	region,
}: ComposerCapabilityRegionProps<TRegion>): JSX.Element | null {
	const contributions = composition.get(region);
	if (contributions.length === 0) return null;
	return (
		<>
			{contributions.map((contribution) => (
				<Fragment key={contribution.key}>{contribution.value}</Fragment>
			))}
		</>
	);
}
