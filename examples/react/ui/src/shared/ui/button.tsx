import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: "default" | "outline" | "ghost" | "destructive";
  readonly size?: "default" | "sm" | "icon";
};

const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
  default: "bg-zinc-950 text-zinc-50 shadow hover:bg-zinc-800",
  outline: "border border-zinc-200 bg-white/80 shadow-sm hover:bg-zinc-100",
  ghost: "hover:bg-zinc-100 hover:text-zinc-900",
  destructive: "bg-red-600 text-white shadow-sm hover:bg-red-500",
};

const sizes: Record<NonNullable<ButtonProps["size"]>, string> = {
  default: "h-10 px-4 py-2",
  sm: "h-8 rounded-md px-3 text-xs",
  icon: "h-9 w-9",
};

export function Button({
  className,
  variant = "default",
  size = "default",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
