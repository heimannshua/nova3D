import type {ReactNode} from 'react';

export type IconName =
  | 'grid' | 'folder' | 'plus' | 'activity' | 'bell' | 'settings' | 'arrow' | 'back' | 'search' | 'spark' | 'image' | 'text'
  | 'close' | 'check' | 'clock' | 'dots' | 'chevron-down' | 'help'
  | 'check-circle' | 'alert-triangle' | 'x-octagon' | 'info-circle' | 'dash-circle'
  | 'doc' | 'inference' | 'split' | 'question' | 'person';

// Icons whose meaning points somewhere. They flip in right-to-left layouts (CSS: .icon-directional);
// every other icon is symmetric and stays as drawn.
const directional = new Set<IconName>(['arrow', 'back']);

const paths: Record<IconName, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  folder: <><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/><path d="M3 9h18"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  activity: <><path d="M4 14.5 8 10l3 3 5-7 4 3.5"/><path d="M4 19h16"/></>,
  bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 22h4"/></>,
  settings: <><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"/><path d="m19.4 15 .1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.8 1.8 0 0 0-3.1 1.3v.2a2 2 0 1 1-4 0v-.2a1.8 1.8 0 0 0-3.1-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.8 1.8 0 0 0 2.3 12a1.8 1.8 0 0 0 1.3-3.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.8 1.8 0 0 0 9.5 4.8v-.2a2 2 0 1 1 4 0v.2a1.8 1.8 0 0 0 3.1 1.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.8 1.8 0 0 0 20.7 12a1.8 1.8 0 0 0-1.3 3.1Z"/></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6"/>,
  back: <path d="M19 12H5M11 6l-6 6 6 6"/>,
  search: <><circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.2 4.2"/></>,
  spark: <><path d="m12 3-1.3 5.7L5 10l5.7 1.3L12 17l1.3-5.7L19 10l-5.7-1.3z"/><path d="m19 16-.5 2.5L16 19l2.5.5L19 22l.5-2.5L22 19l-2.5-.5z"/></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-4.5-4.5L7 20"/></>,
  text: <><path d="M4 6h16M4 12h11M4 18h16"/><path d="M18 10v8M14 14h8"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  clock: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></>,
  dots: <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>,
  'chevron-down': <path d="m6 9 6 6 6-6"/>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8"/><path d="M12 17h.01"/></>,
  // Status shapes: a circle with a check, a triangle, an octagon with a cross, a circle with an i, a circle with a dash.
  'check-circle': <><circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.8 2.8L16.3 9.5"/></>,
  'alert-triangle': <><path d="M12 3.5 22 20H2z"/><path d="M12 10v4.5M12 17.5h.01"/></>,
  'x-octagon': <><path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2z"/><path d="m9 9 6 6M15 9l-6 6"/></>,
  'info-circle': <><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/></>,
  'dash-circle': <><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></>,
  // Evidence shapes: a page, a branching arrow, two opposed arrows, a question mark, a person.
  doc: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></>,
  inference: <><path d="M4 18 10 12l4 4 6-8"/><path d="M15 8h5v5"/></>,
  split: <><path d="M12 20v-7"/><path d="m12 13-6-6M12 13l6-6"/><path d="M6 11V7h4M18 11V7h-4"/></>,
  question: <><path d="M9 9a3 3 0 1 1 4.5 2.6c-1 .6-1.5 1.2-1.5 2.4"/><path d="M12 18h.01"/></>,
  person: <><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/></>,
};

/** Decorative by default (aria-hidden): the control or label next to it always carries the name. Sized in rem. */
export function Icon({name, size = 18}: {name: IconName; size?: number}) {
  const dimension = `${size / 16}rem`;
  return (
    <svg
      className={directional.has(name) ? 'icon icon-directional' : 'icon'}
      style={{width: dimension, height: dimension}}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
