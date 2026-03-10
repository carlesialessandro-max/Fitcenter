import * as React from "react"
import { cn } from "../lib/utils"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "secondary" | "outline" | "ghost" | "destructive"
  size?: "default" | "sm" | "lg"
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        className={cn(
          "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:pointer-events-none disabled:opacity-50",
          variant === "default" && "bg-amber-500 text-zinc-950 hover:bg-amber-400",
          variant === "secondary" && "bg-zinc-700 text-zinc-100 hover:bg-zinc-600",
          variant === "outline" && "border border-zinc-600 bg-transparent text-zinc-100 hover:bg-zinc-800",
          variant === "ghost" && "text-zinc-100 hover:bg-zinc-800",
          variant === "destructive" && "bg-red-600 text-white hover:bg-red-500",
          size === "default" && "h-9 px-4 py-2",
          size === "sm" && "h-8 rounded-md px-3 text-sm",
          size === "lg" && "h-10 rounded-md px-8",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }
