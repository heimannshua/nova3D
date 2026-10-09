// A message is plain text with {name} placeholders, or plural forms chosen by a {count} parameter.
// Plural categories follow the locale (Intl.PluralRules): English needs one and other, Hebrew also two.
export type PluralForms = {zero?: string; one?: string; two?: string; few?: string; many?: string; other: string};
export type Message = string | PluralForms;
export type Params = Record<string, string | number>;
