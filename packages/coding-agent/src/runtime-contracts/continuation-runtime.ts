import type { UserMessage } from "@astravia/ai";
import type { ContinuationPolicyContext } from "@astravia/runtime-core/kernel";

export interface CodingAgentContinuationSource {
	collect(context: ContinuationPolicyContext): Promise<readonly UserMessage[]>;
}
