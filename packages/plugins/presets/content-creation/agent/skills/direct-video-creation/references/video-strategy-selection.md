# Video strategy selection

Choose a generation strategy from the creative control contract, not merely from the number of files the user supplied.

| Strategy | Choose when | Do not choose when | Prompt plan kind |
| --- | --- | --- | --- |
| Text to video | No external image or video must be authoritative | Identity, product geometry, composition, or an endpoint must match supplied media | `text-to-video-plan` |
| Animate still | One image defines the opening composition and visible identity | The ending must match an independent image, or several references control different facts | `animate-still-plan` |
| First/last frame | Both frozen endpoints must be authoritative within one continuous shot | Only a general editorial ending is requested | `first-last-frame-plan` |
| Omni reference | Several assets control identity, product, environment, style, motion, or audio | One still alone is sufficient as the opening authority | `omni-reference-plan` |
| Transform video | One source video supplies timing, motion, or performance to preserve or alter | The request only needs a new clip inspired by a still | `transform-video-plan` |

## Decision procedure

1. List the facts that must be exact: opening, ending, identity, product geometry, environment, choreography, source timing, or nothing external.
2. Identify one authority for each exact fact. Remove redundant or conflicting references.
3. Select the least complex strategy that can satisfy every authority.
4. Confirm the inspected model exposes the required input roles. Never downgrade an exact requirement to fit an available model.
5. Use the matching prompt plan kind. A mismatch means the creative method and workflow topology disagree.

`automatic` is a capability-aware resolver, not a substitute for creative reasoning. Even with `strategy="automatic"`, provide the matching strategy-specific prompt plan and explicit control requirements.
