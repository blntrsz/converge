import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type BadgeProps = HTMLAttributes<HTMLDivElement> & {
  readonly variant?: "default" | "outline" | "secondary";
};

const variants: Record<NonNullable<BadgeProps["variant"]>, string> = {
  default: "border-transparent bg-zinc-950 text-zinc-50",
  outline: "border-zinc-200 bg-white/70 text-zinc-700",
  secondary: "border-transparent bg-zinc-100 text-zinc-700",
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
