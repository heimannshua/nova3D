import type {ReactNode} from 'react';
import {Icon, type IconName} from './icon';

type StateProps = {title: string; children?: ReactNode; action?: ReactNode; headingLevel?: 1 | 2 | 3; icon?: IconName};

function Heading({level, children}: {level: 1 | 2 | 3; children: ReactNode}) {
  if (level === 1) return <h1 className="state-title">{children}</h1>;
  return level === 2 ? <h2 className="state-title">{children}</h2> : <h3 className="state-title">{children}</h3>;
}

/** Nothing to show yet. Says what will appear and, when there is one, offers the next action. */
export function EmptyState({title, children, action, headingLevel = 2, icon = 'search'}: StateProps) {
  return (
    <section className="state state-empty">
      <span className="state-icon"><Icon name={icon} size={22}/></span>
      <Heading level={headingLevel}>{title}</Heading>
      {children ? <p className="state-body">{children}</p> : null}
      {action}
    </section>
  );
}

/**
 * Something failed. The words and the octagon shape carry the meaning, not just the red.
 * Pass live when the error appears in response to an action, so assistive technology announces it.
 */
export function ErrorState({title, children, action, headingLevel = 2, live = false}: Omit<StateProps, 'icon'> & {live?: boolean}) {
  return (
    <section className="state state-error" role={live ? 'alert' : undefined}>
      <span className="state-icon"><Icon name="x-octagon" size={22}/></span>
      <Heading level={headingLevel}>{title}</Heading>
      {children ? <p className="state-body">{children}</p> : null}
      {action}
    </section>
  );
}

export type NoticeTone = 'info' | 'success' | 'danger' | 'warning';
const noticeIcons: Record<NoticeTone, IconName> = {info: 'info-circle', success: 'check-circle', danger: 'x-octagon', warning: 'alert-triangle'};

/** An inline message with a shape as well as a colour. Use role="alert" only for errors that appear after an action. */
export function Notice({tone = 'info', children, role, action}: {tone?: NoticeTone; children: ReactNode; role?: 'alert' | 'note' | 'status'; action?: ReactNode}) {
  return (
    <div className={`notice notice-${tone}`} role={role}>
      <span className="notice-icon"><Icon name={noticeIcons[tone]} size={16}/></span>
      <p className="notice-text">{children}</p>
      {action}
    </div>
  );
}
