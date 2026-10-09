'use client';

import {useEffect, useId, useRef, type ReactNode} from 'react';
import {IconButton} from './button';
import type {IconName} from './icon';

/**
 * A disclosure: a button that opens a panel next to it. Focus stays on the button and the panel follows it
 * in tab order. Escape closes it and returns focus to the button, as does moving focus out or clicking away.
 */
export function Popover({icon, label, open, onOpenChange, panelLabel, badge, triggerClassName, children}: {
  icon: IconName;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panelLabel: string;
  badge?: ReactNode;
  triggerClassName?: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const container = root.current;
      if (!container || container.contains(event.target as Node)) return;
      // Focus inside the menu would be lost when it closes under a click on blank space: the click leaves it on
      // the page body, or on a region that only takes programmatic focus (main has tabindex -1). So once the
      // click has finished moving focus, hand it back to the button, unless the click landed on a control.
      const hadFocus = container.contains(document.activeElement);
      onOpenChange(false);
      if (hadFocus) {
        setTimeout(() => {
          const active = document.activeElement;
          if (!active || active === document.body || active.getAttribute('tabindex') === '-1') trigger.current?.focus();
        }, 0);
      }
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open, onOpenChange]);

  return (
    <div
      className="popover"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          onOpenChange(false);
          trigger.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (open && event.relatedTarget instanceof Node && root.current && !root.current.contains(event.relatedTarget)) onOpenChange(false);
      }}
    >
      <IconButton ref={trigger} icon={icon} label={label} className={triggerClassName} aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => onOpenChange(!open)}/>
      {badge}
      {open ? <div id={panelId} role="region" aria-label={panelLabel} className="popover-panel">{children}</div> : null}
    </div>
  );
}
