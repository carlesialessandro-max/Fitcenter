import { cn } from "@workspace/ui/lib/utils"

const SRC_COMPACT = "/brand/h2sport-logo.png"
const SRC_PAYOFF = "/brand/h2sport-logo-payoff.png"

type BrandLogoProps = {
  /** `compact`: logo stack H2/SPORT. `payoff`: include payoff (login / intestazioni ampie). */
  variant?: "compact" | "payoff"
  className?: string
  imgClassName?: string
}

export function BrandLogo({ variant = "compact", className, imgClassName }: BrandLogoProps) {
  const src = variant === "payoff" ? SRC_PAYOFF : SRC_COMPACT
  return (
    <div className={cn("flex shrink-0 items-center", className)}>
      <img
        src={src}
        alt="H2 Sport"
        className={cn(
          variant === "payoff" ? "h-14 max-h-[4.5rem] w-auto max-w-[min(100%,220px)] object-contain object-left" : "h-9 w-auto max-w-[140px] object-contain object-left",
          imgClassName
        )}
        decoding="async"
        loading="eager"
      />
    </div>
  )
}
