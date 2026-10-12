'use client';

import {useEffect, useId, useRef, useState, type FormEvent} from 'react';
import {issueNamedInvitation} from '@/app/admin/invitations/actions';
import {useI18n} from '@/lib/i18n/react';
import {labelErrorKeys, labelProblem, maxLabelLength, normalizeLabel, type IssuedCode, type LabelProblem} from '@/lib/invitations';
import {useInvitationAction} from '../use-invitation-action';
import {Button} from '../ui/button';
import {Notice} from '../ui/states';
import {FailureNotice} from './failure-notice';

/**
 * "Named code" (AD-01): one single-use code for one person. The name is a label for the Administrator, not bound to
 * an address, and it is the only thing typed. A blank or over-long name is answered here, in the person's language,
 * before anything is sent. The made code goes to the page (`onIssued`) and this form keeps only that one was made, so
 * the code is held in one place in the browser; every other answer leaves what was typed where it was. Submitting
 * clears the field only when the code was made.
 */
export function NamedCodeForm({onIssued}: {onIssued: (code: IssuedCode) => void}) {
  const {t} = useI18n();
  const fieldId = useId();
  const hintId = useId();
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  // What the field holds. It is controlled: React resets a form's uncontrolled fields when its action settles, which is
  // after the answer has come and the page has been refreshed, and would take with it a name typed in between.
  const [typed, setTyped] = useState('');
  const [local, setLocal] = useState<LabelProblem | null>(null);

  const {state, formAction, pending, onSubmit} = useInvitationAction(issueNamedInvitation, (next, formData) => {
    if (next.outcome === 'issued') {
      onIssued({invitationId: next.invitationId, kind: next.kind, label: next.label, code: next.code, replacedInvitationId: next.replacedInvitationId});
      // The field empties, unless the person has already started the next name: then it is theirs.
      const sent = formData.get('label');
      setTyped((current) => (current === sent ? '' : current));
      return {outcome: 'created'};
    }
    // Every other answer leaves what was typed where it was.
    return next;
  });

  const problem = pending ? null : (local ?? (state.outcome === 'invalid' ? state.problem : null));
  useEffect(() => {
    if (state.outcome === 'invalid') input.current?.focus();
  }, [state]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    const found = labelProblem(normalizeLabel(new FormData(event.currentTarget).get('label')));
    if (found) {
      event.preventDefault();
      setLocal(found);
      input.current?.focus();
      return;
    }
    setLocal(null);
    onSubmit(event);
  };

  return (
    <section className="settings-section" aria-labelledby={`${fieldId}-title`}>
      <h2 id={`${fieldId}-title`}>{t('invitations.named.title')}</h2>
      <p className="settings-help">{t('invitations.named.help')}</p>
      <form action={formAction} onSubmit={submit} noValidate className="invite-form">
        <div className="invite-field">
          <label htmlFor={fieldId} className="auth-label">{t('invitations.named.label')}</label>
          <input
            ref={input}
            id={fieldId}
            name="label"
            type="text"
            className="invite-input"
            value={typed}
            autoComplete="off"
            aria-required="true"
            aria-describedby={problem ? `${hintId} ${errorId}` : hintId}
            aria-invalid={problem ? true : undefined}
            onChange={(event) => {
              setTyped(event.target.value);
              if (local) setLocal(null);
            }}
          />
          <p id={hintId} className="auth-hint">{t('invitations.named.hint', {max: maxLabelLength})}</p>
          {problem ? <div className="invite-notice"><Notice id={errorId} tone="danger" role="alert">{t(labelErrorKeys[problem])}</Notice></div> : null}
        </div>
        <Button variant="primary" type="submit" aria-disabled={pending ? true : undefined}>{t('invitations.named.submit')}</Button>
        <p className="auth-hint auth-status" role="status">{pending ? t('invitations.named.pending') : null}</p>
      </form>
      {pending ? null : <FailureNotice state={state}/>}
    </section>
  );
}
