export const IM_SEND_ATTACHMENT_TOOL_DESCRIPTION = `Send a local file as an attachment to the current IM conversation (e.g. WeChat).

Use when you have produced an artifact the user should receive as a file or image rather than as a code block — for example a generated PDF, a screenshot, a packaged zip, or an image you composed. Each call delivers exactly one attachment and counts as one outbound message against the per-peer quota.

Parameters:
- path: Absolute path to the local file to send. Must exist and be readable.
- kind: "image" for jpg/png/gif/webp images that should be rendered inline by the IM client; "file" for everything else (pdf, zip, generic documents).
- caption: Optional short text to accompany the attachment. Some platforms render it as a follow-up text message; treat it as non-essential.

On success, returns a \`messageId\` and the kind that was sent. On quota exhaustion the tool returns an error containing \`quota_exhausted\` — when this happens, do NOT retry in the same turn; either tell the user to reply (which resets the window) or finish the turn without the attachment. Other failures (file not found, peer unreachable, transport error) are also returned as errors — surface them to the user verbatim.

This tool is only registered when the agent was started with \`--mode rpc --enable-host-bridge\`.`;
