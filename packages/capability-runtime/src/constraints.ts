import { CAPABILITY_CONSTRAINT_KINDS, type CapabilityConstraint, type CapabilityId } from "@vetta-org/capability-sdk";

export interface CapabilityConstraintEvaluation {
	readonly capabilityId: CapabilityId;
	readonly constraint: CapabilityConstraint;
	readonly input: unknown;
}

export interface CapabilityConstraintEvaluator {
	readonly kind: string;
	evaluate(evaluation: CapabilityConstraintEvaluation): boolean;
}

export const namespaceConstraintEvaluator: CapabilityConstraintEvaluator = {
	kind: CAPABILITY_CONSTRAINT_KINDS.NAMESPACE,
	evaluate({ constraint, input }) {
		return (
			typeof input === "object" &&
			input !== null &&
			!Array.isArray(input) &&
			"namespace" in input &&
			input.namespace === constraint.value
		);
	},
};
