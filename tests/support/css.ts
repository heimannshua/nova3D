// A small CSS reader for tests: enough to pull custom-property values out of globals.css by selector
// and media query, and to check the file for forbidden patterns. Not a general CSS parser.

export type Rule = {at: string | null; selector: string; body: string};

export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Style rules, each with the at-rule prelude it sits in (for example "@media (prefers-contrast: more)"). */
export function parseRules(source: string): Rule[] {
  const css = stripComments(source);
  const rules: Rule[] = [];
  const stack: string[] = [];
  let buffer = '';
  for (let i = 0; i < css.length; i += 1) {
    const char = css[i];
    if (char === '{') {
      const prelude = buffer.trim();
      buffer = '';
      if (prelude.startsWith('@') && !prelude.startsWith('@font-face')) {
        stack.push(prelude);
        continue;
      }
      // A style rule: read to its matching closing brace.
      let depth = 1;
      let j = i + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth += 1;
        if (css[j] === '}') depth -= 1;
        j += 1;
      }
      rules.push({at: stack.length ? stack.join(' > ') : null, selector: prelude, body: css.slice(i + 1, j - 1)});
      i = j - 1;
    } else if (char === '}') {
      stack.pop();
      buffer = '';
    } else if (char === ';' && stack.length === 0 && !buffer.includes('{')) {
      buffer = '';
    } else {
      buffer += char;
    }
  }
  return rules;
}

export function customProperties(body: string): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) properties[match[1]] = match[2].trim();
  return properties;
}

/** The custom properties of every rule with this exact selector inside this exact at-rule (null for none). */
export function tokensFor(rules: Rule[], selector: string, at: string | null = null): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const rule of rules) if (rule.selector === selector && rule.at === at) Object.assign(merged, customProperties(rule.body));
  return merged;
}
