import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from "react";

type ButtonVariant = "primary" | "secondary";
type ButtonSize = "default" | "compact";

interface CommonButtonProps {
  children: ReactNode;
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

type ButtonElementProps = CommonButtonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className"> & {
    href?: never;
  };

type ButtonLinkProps = CommonButtonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "className" | "href"> & {
    href: string;
  };

type ButtonProps = ButtonElementProps | ButtonLinkProps;

export function Button(props: ButtonProps) {
  const {
    children,
    variant = "primary",
    size = "default",
    className = "",
  } = props;
  const classes = [
    "button",
    `button--${variant}`,
    `button--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (props.href) {
    const linkProps = props as ButtonLinkProps;
    const {
      children: _children,
      className: _className,
      href,
      size: _size,
      variant: _variant,
      ...anchorProps
    } = linkProps;

    return (
      <a className={classes} href={href} {...anchorProps}>
        {children}
      </a>
    );
  }

  const buttonElementProps = props as ButtonElementProps;
  const {
    children: _children,
    className: _className,
    href: _href,
    size: _size,
    type = "button",
    variant: _variant,
    ...buttonProps
  } = buttonElementProps;

  return (
    <button className={classes} type={type} {...buttonProps}>
      {children}
    </button>
  );
}

