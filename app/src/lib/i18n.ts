/**
 * String externalization (NFR-17, AD-15).
 *
 * Rules this file exists to enforce:
 *   · No concatenated sentence fragments. A sentence is one key.
 *   · No text baked into images.
 *   · Layout must survive a doubling of string length.
 *   · Two wording levels say the SAME thing. Technical wording never changes
 *     the evidence, the decisions, or the actions available (FR-47).
 *
 * AD-15 has not been ratified, so this is a placeholder mechanism rather than
 * the chosen one. It is shaped so that swapping in a real library is a change
 * behind `translate()` rather than at every call site.
 *
 * Only interface chrome is translated here. Source text is never translated by
 * this mechanism — original language, translation and explanation are three
 * separate blocks carried on the Passage itself.
 */

import type { AccountSettings } from '@/api'

type Locale = AccountSettings['locale']
type Wording = AccountSettings['wording']
type Entry = string | { ordinary: string; technical: string }

const en: Record<string, Entry> = {
  'app.name': 'nova3D',
  'nav.home': 'Home',
  'nav.projects': 'My Projects',
  'nav.create': 'Create',
  'nav.jobs': 'In Progress',
  'nav.printers': 'Printers',
  'nav.notifications': 'Notifications',
  'nav.settings': 'Settings',
  'nav.admin': 'Administrator',
  'nav.search': 'Search',
  'action.back': 'Back',
  'action.continue': 'Continue',
  'action.leave': 'Leave',
  'action.signOut': 'Sign out',
  'state.saved': 'Saved',
  'state.online': 'Online',
  'state.offline': 'Offline',
  'pending.content': 'verified content pending',
  'pending.value': 'value pending',
  'status.sourced': 'sourced',
  'status.inferred': 'inferred',
  'status.disputed': 'disputed',
  'status.unknown': 'unknown',
  'status.user-added': 'user-added',
  'validation.qualified': {
    ordinary: 'Checked against the printer and material you chose. It is not a promise that the print will work.',
    technical: 'Validated against the named Target Print Profile. Not a certification of safety or universal manufacturability.',
  },
  'print.reported': {
    ordinary: 'This is what the printer says, not something nova3D checked itself.',
    technical: 'Values reported by the printer firmware. Not independently verified by nova3D.',
  },
  'slice.estimate': {
    ordinary: 'Worked out from the slice. Real prints vary.',
    technical: 'Slicer estimate. Actual duration and consumption vary with machine state.',
  },
}

const he: Record<string, Entry> = {
  'app.name': 'nova3D',
  'nav.home': 'בית',
  'nav.projects': 'הפרויקטים שלי',
  'nav.create': 'יצירה',
  'nav.jobs': 'בתהליך',
  'nav.printers': 'מדפסות',
  'nav.notifications': 'התראות',
  'nav.settings': 'הגדרות',
  'nav.admin': 'מנהל',
  'nav.search': 'חיפוש',
  'action.back': 'חזרה',
  'action.continue': 'המשך',
  'action.leave': 'יציאה',
  'action.signOut': 'התנתקות',
  'state.saved': 'נשמר',
  'state.online': 'מחובר',
  'state.offline': 'לא מחובר',
  'pending.content': 'תוכן מאומת בהמתנה',
  'pending.value': 'ערך בהמתנה',
  'status.sourced': 'ממקור',
  'status.inferred': 'הסקה',
  'status.disputed': 'שנוי במחלוקת',
  'status.unknown': 'לא ידוע',
  'status.user-added': 'נוסף על ידי המשתמש',
}

const catalogs: Record<Locale, Record<string, Entry>> = { en, he }

export function translate(key: string, locale: Locale, wording: Wording): string {
  const entry = catalogs[locale]?.[key] ?? catalogs.en[key]
  if (entry === undefined) return key
  return typeof entry === 'string' ? entry : entry[wording]
}
