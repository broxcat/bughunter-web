import * as React from "react";

/**
 * The full semantic tone scale. These are the ONLY approved colors for
 * severity / confidence / gate status — never hand-write hex or zinc/red
 * classes for these meanings, render a <Badge tone="..."> instead. The actual
 * colors (light + dark) live in src/styles/tokens.css.
 */
export type BadgeTone =
  | "neutral"
  | "brand"
  // severity scale (rainbow, NOT shades of brand red)
  | "info"
  | "low"
  | "medium"
  | "high"
  | "critical"
  // confidence
  | "proven"
  | "candidate"
  // gate status
  | "passed"
  | "killed"
  | "unvalidated";

type BadgeProps = {
  tone?: BadgeTone;
  /** Render the label in the mono font (good for IDs, hashes, statuses). */
  mono?: boolean;
  className?: string;
  children: React.ReactNode;
};

export function Badge({
  tone = "neutral",
  mono = false,
  className,
  children,
}: BadgeProps): React.JSX.Element {
  return (
    <span
      data-tone={tone}
      data-mono={mono ? "true" : undefined}
      className={["ui-badge", className].filter(Boolean).join(" ")}
    >
      {children}
    </span>
  );
}
