import Link from 'next/link';
import type {ButtonHTMLAttributes, ComponentProps, ComponentPropsWithRef, ReactNode} from 'react';
import {Icon, type IconName} from './icon';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

export function buttonClass(variant: ButtonVariant = 'secondary', extra?: string) {
  return ['btn', `btn-${variant}`, extra].filter(Boolean).join(' ');
}

type Shared = {variant?: ButtonVariant; icon?: IconName; iconAfter?: IconName; children: ReactNode};

/** A native button. The minimum touch target (44 px) and the focus ring come from the .btn styles. */
export function Button({variant = 'secondary', icon, iconAfter, className, type = 'button', children, ...rest}: Shared & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <button type={type} className={buttonClass(variant, className)} {...rest}>
      {icon ? <Icon name={icon} size={17}/> : null}
      <span>{children}</span>
      {iconAfter ? <Icon name={iconAfter} size={15}/> : null}
    </button>
  );
}

/** A link that looks like a button. Use it for navigation; use Button for actions. */
export function LinkButton({variant = 'secondary', icon, iconAfter, className, children, ...rest}: Shared & Omit<ComponentProps<typeof Link>, 'children'>) {
  return (
    <Link className={buttonClass(variant, className)} {...rest}>
      {icon ? <Icon name={icon} size={17}/> : null}
      <span>{children}</span>
      {iconAfter ? <Icon name={iconAfter} size={15}/> : null}
    </Link>
  );
}

/** An icon-only button. The accessible name is required, because the icon is decorative. */
export function IconButton({icon, label, className, type = 'button', ...rest}: {icon: IconName; label: string} & Omit<ComponentPropsWithRef<'button'>, 'aria-label' | 'children'>) {
  return (
    <button type={type} className={['icon-btn', className].filter(Boolean).join(' ')} aria-label={label} {...rest}>
      <Icon name={icon}/>
    </button>
  );
}
