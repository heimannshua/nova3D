import type {ReactNode} from 'react';

/** One radio choice, drawn as a 44 px card. The group around it carries the name and `role="radiogroup"`. */
export function Choice({name, value, checked, onChange, children}: {name: string; value: string; checked: boolean; onChange: () => void; children: ReactNode}) {
  return (
    <label className="choice">
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange}/>
      <span className="choice-text">{children}</span>
    </label>
  );
}
