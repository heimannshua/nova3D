'use client';

import {useState} from 'react';
import {useI18n} from '@/lib/i18n/react';
import {Button} from '../ui/button';
import {Dialog} from '../ui/dialog';
import {Explanation} from '../ui/explain';
import {Icon, type IconName} from '../ui/icon';

type Intake = 'text' | 'image';

const options = [
  {value: 'text', icon: 'text', title: 'create.textTitle', copy: 'create.textCopy', tone: 'violet'},
  {value: 'image', icon: 'image', title: 'create.imageTitle', copy: 'create.imageCopy', tone: 'blue'},
] as const satisfies readonly {value: Intake; icon: IconName; title: 'create.textTitle' | 'create.imageTitle'; copy: 'create.textCopy' | 'create.imageCopy'; tone: string}[];

/** Where a new project starts. The choice is a radio group, so arrow keys and screen readers work as expected. */
export function CreateDialog({onClose}: {onClose: () => void}) {
  const {t} = useI18n();
  const [choice, setChoice] = useState<Intake | null>(null);

  return (
    <Dialog eyebrow={t('create.eyebrow')} title={t('create.title')} description={t('create.body')} closeLabel={t('create.close')} onClose={onClose} className="create-dialog">
      <fieldset className="choice-group">
        <legend className="visually-hidden">{t('create.legend')}</legend>
        {options.map((option) => (
          <label key={option.value} className="choice choice-rich">
            <input type="radio" name="intake" value={option.value} checked={choice === option.value} onChange={() => setChoice(option.value)}/>
            <span className={`option-icon option-${option.tone}`}><Icon name={option.icon} size={22}/></span>
            <span className="choice-text">
              <strong>{t(option.title)}</strong>
              <small>{t(option.copy)}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <div aria-live="polite" className="choice-next-wrap">
        {choice ? (
          <div className="choice-next">
            <span className="choice-check"><Icon name="check" size={16}/></span>
            <p>
              <strong>{choice === 'text' ? t('create.textSelected') : t('create.imageSelected')}</strong>
              <br/>
              {choice === 'text'
                ? <Explanation simple="create.textNext" technical="create.textTechnical"/>
                : <Explanation simple="create.imageNext" technical="create.imageTechnical"/>}
            </p>
            <Button variant="primary" iconAfter="arrow" onClick={onClose}>{t('create.continue')}</Button>
          </div>
        ) : null}
      </div>
      <p className="dialog-footnote"><span className="dot" aria-hidden="true"/>{t('create.footnote')}</p>
    </Dialog>
  );
}
