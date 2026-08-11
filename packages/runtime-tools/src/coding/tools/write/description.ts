export const WRITE_TOOL_DESCRIPTION = `Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.

When to use \`write\` vs \`edit\`:
- Use \`write\` ONLY for creating NEW files or COMPLETE rewrites where most of the content changes.
- For modifying specific parts of an existing file, ALWAYS prefer \`edit\` — it is more precise and less error-prone.
- NEVER use bash commands (echo >, cat <<EOF, tee, printf >) to write files — always use this tool or \`edit\`.

CRITICAL: If overwriting an existing file, you MUST read it first with \`read\` to understand its current contents. Do NOT blindly overwrite files without reading them.`;
