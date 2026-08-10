# Repair policy

## Map evidence to a causal layer

1. Brief failure: missing or contradictory requirement -> repair objective or prompt.
2. Reference failure: weak, dirty, conflicting, or misassigned input -> repair reference selection/role.
3. Structure failure: overloaded shot or wrong workflow shape -> split/reorder nodes or timeline.
4. Capability failure: mode lacks required input/output behavior -> reroute model/mode.
5. Stochastic failure: sound setup, isolated bad sample -> retry the same node once.

## Preserve successful dimensions

State what must remain unchanged: composition, subject identity, palette, motion, camera, timing, or approved reference. Change one major variable per iteration. A broad rewrite is justified only when the concept itself failed.

## Stop unproductive retries

After two comparable failures, do not repeat the same setup. Reinspect capabilities and change the causal layer. If no capability supports a hard requirement, report the limitation and offer a reduced requirement or external production step.

## Select before scaling

When multiple assets depend on a direction, approve the cheapest representative candidate first. Do not generate crops, shots, or variants from an unapproved master.
