import * as React from "react"

import { cn } from "../../lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-border/60 bg-transparent px-2.5 py-1 text-base shadow-none transition-[border-color,background-color] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:border-border focus-visible:border-ring/60 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/30 disabled:opacity-50 aria-invalid:border-destructive/70 md:text-sm dark:bg-input/20 dark:disabled:bg-input/50 dark:aria-invalid:border-destructive/60",
        className
      )}
      {...props}
    />
  )
}

export { Input }
