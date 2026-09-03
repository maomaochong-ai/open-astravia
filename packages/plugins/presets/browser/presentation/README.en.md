## Best suited for

Browser Use is for work that must happen inside a real page: signing in to an admin console, paging through data, filling forms, changing filters, or collecting results across several pages. Prefer web search when a public-information summary is enough; use browser operation when the agent must enter a page and complete the workflow.

## How to use it

State the goal, URL, and boundaries directly in the conversation. For sign-in, captchas, or two-factor authentication, the agent hands you the visible browser window and continues after you finish. For publishing, payments, deletion, or final submission, explicitly ask it to stop before confirmation.

On first use, the agent checks and automatically installs the plugin-pinned `agent-browser` runtime in Vetta's private npm directory. If no reusable Chrome is available, it installs Chrome for Testing after a health check. Vetta manages this runtime separately and does not overwrite a global installation; use the plugin panel to retry and diagnose an automated setup failure.

## Sessions and privacy

Every agent conversation uses an independent browser session and cannot take over another conversation's active page. Use a stable profile when sign-in state must persist, and separate account keys for multiple accounts in one task. Never put email addresses, passwords, cookies, or tokens in profile names, prompts, or logs.
