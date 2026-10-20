import * as React from "react";

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
};

/**
 * Surface container (panel / card). Background, border, radius and shadow come
 * from tokens via the `.ui-card` class, so it reads correctly in both themes.
 * Padding/spacing is left to the caller (compose with Tailwind utilities).
 */
export function Card({
  className,
  children,
  ...rest
}: CardProps): React.JSX.Element {
  return (
    <div className={["ui-card", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}
