import * as React from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
};

/**
 * Themed button. Colors come entirely from design tokens via the `.ui-btn`
 * classes in globals.css (data-variant / data-size select the look), so it
 * stays correct in light and dark without inline colors.
 */
export function Button({
  variant = "primary",
  size = "md",
  className,
  type,
  children,
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={type ?? "button"}
      data-variant={variant}
      data-size={size}
      className={["ui-btn", className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
