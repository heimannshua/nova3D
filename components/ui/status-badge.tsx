import type {ReactNode} from 'react';
import {Icon, type IconName} from './icon';

// Status never relies on colour alone: every tone has its own shape and always shows a word.
export type StatusTone =
  | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'running'
  | 'sourced' | 'inferred' | 'disputed' | 'unknown' | 'user-added';

export const toneShapes: Record<StatusTone, IconName> = {
  success: 'check-circle',
  warning: 'alert-triangle',
  danger: 'x-octagon',
  info: 'info-circle',
  neutral: 'dash-circle',
  running: 'activity',
  sourced: 'doc',
  inferred: 'inference',
  disputed: 'split',
  unknown: 'question',
  'user-added': 'person',
};

export function StatusBadge({tone, children, icon}: {tone: StatusTone; children: ReactNode; icon?: IconName}) {
  return (
    <span className={`status-badge tone-${tone}`}>
      <Icon name={icon ?? toneShapes[tone]} size={14}/>
      <span>{children}</span>
    </span>
  );
}
