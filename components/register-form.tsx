'use client';

import {unstable_rethrow} from 'next/navigation';
import {useActionState, useEffect, useRef, useState} from 'react';
import {useI18n} from '@/lib/i18n/react';
import {isCommandId, newCommandId, registerErrorKeys, type RegisterState} from '@/lib/register';
import {BrandMark} from './shell/brand';
import {Button} from './ui/button';
import {Notice} from './ui/states';
import {mainContentId} from './ui/skip-link';

export type RegisterAction = (previous: RegisterState, formData: FormData) => Promise<RegisterState>;
export type Navigate = (to: string) => void;

const goTo: Navigate = (to) => window.location.assign(to);

/**
 * Whether a failed call never got an answer at all. A browser reports a dropped connection or an
 * unreachable server from fetch as a TypeError; anything else that reaches here is an answer, just not the
 * action's.
 */
const isNetworkFailure = (error: unknown) => error instanceof TypeError;

/**
 * Calls the registration action and keeps the command ID honest.
 *
 *  - A blank field is answered here, in the person's language, without a request.
 *  - A command ID belongs to the code it was first sent with. After an attempt whose outcome is unknown,
 *    the same code is the same command; an edited code is a new one (`pendingCode` is the code that had
 *    gone out).
 *  - A redirect (success, or a refusal that sends the person elsewhere) travels as a thrown error and is
 *    rethrown for Next.js to follow.
 *  - A dropped connection leaves the outcome unknown: keep the command ID and ask for a retry.
 *  - Any other failure is the server answering with something that is not the action's, which is what a
 *    redirect by the proxy looks like to a Server Action (signed out, disabled, or already registered):
 *    the form is stale. Go to /register and let the proxy send the person where they belong.
 */
export async function attemptRegistration(
  action: RegisterAction,
  previous: RegisterState,
  formData: FormData,
  options: {pendingCode?: string; navigate?: Navigate} = {},
): Promise<RegisterState> {
  const typed = formData.get('code');
  const code = typeof typed === 'string' ? typed : '';
  if (!code.trim()) return {commandId: previous.commandId, error: 'empty'};

  const submitted = formData.get('commandId');
  let commandId = isCommandId(submitted) ? submitted : previous.commandId;
  if (options.pendingCode !== undefined && options.pendingCode !== code) {
    commandId = newCommandId();
    formData.set('commandId', commandId);
  }

  try {
    return await action(previous, formData);
  } catch (error) {
    unstable_rethrow(error);
    if (isNetworkFailure(error)) return {commandId, error: 'unavailable'};
    (options.navigate ?? goTo)('/register');
    return {commandId, error: null};
  }
}

/** "Use a different Google account": a refusal by the proxy (the session is already gone) still ends at sign-in. */
export async function attemptSwitch(action: () => Promise<void>, navigate: Navigate = goTo) {
  try {
    await action();
  } catch (error) {
    unstable_rethrow(error);
    navigate('/login');
  }
}

/**
 * The registration screen (A-02): the signed-in Google identity enters an invitation code. `register` and
 * `switchAccount` are Server Actions, passed in by the page. The code field is cleared after a definitive
 * answer and kept after an unknown one, so a retry sends the same code under the same command ID.
 */
export function RegisterForm({email, initialCommandId, register, switchAccount}: {
  email: string | null;
  initialCommandId: string;
  register: RegisterAction;
  switchAccount: () => Promise<void>;
}) {
  const {t} = useI18n();
  const input = useRef<HTMLInputElement>(null);
  // The code an attempt of unknown outcome went out with. Read only when the next attempt is made.
  const pendingCode = useRef<string | undefined>(undefined);
  // What the field holds after an attempt. The version remounts the field (so React's form reset restores
  // it) and the alert (so every failed attempt is announced afresh).
  const [kept, setKept] = useState({code: '', version: 0});
  const [state, formAction, pending] = useActionState(async (previous: RegisterState, formData: FormData) => {
    const next = await attemptRegistration(register, previous, formData, {pendingCode: pendingCode.current});
    const typed = formData.get('code');
    const unknown = next.error === 'unavailable' && typeof typed === 'string';
    pendingCode.current = unknown ? typed : undefined;
    // Only an unknown outcome (or a blank field, which sent nothing) keeps what was typed.
    setKept((current) => ({code: unknown || next.error === 'empty' ? String(typed ?? '') : '', version: current.version + 1}));
    return next;
  }, {commandId: initialCommandId, error: null});

  useEffect(() => {
    if (state.error) input.current?.focus();
  }, [state]);

  // The previous answer is not shown while a new attempt is under way.
  const error = pending ? null : state.error;
  const guard = (event: {preventDefault(): void}) => {
    if (pending) event.preventDefault();
  };

  return (
    <main id={mainContentId} tabIndex={-1} className="auth-shell">
      <section className="auth-card" aria-labelledby="register-title">
        <BrandMark/>
        <p className="eyebrow">{t('register.eyebrow')}</p>
        <h1 id="register-title">{t('register.title')}</h1>
        <p className="auth-lede">{email ? t('register.lede', {email}) : t('register.ledeNoEmail')}</p>
        <Notice tone="info" role="note">{t('register.operator')}</Notice>
        {error ? <Notice key={kept.version} id="register-error" tone="danger" role="alert">{t(registerErrorKeys[error])}</Notice> : null}
        <form action={formAction} onSubmit={guard} noValidate className="auth-form">
          <input type="hidden" name="commandId" value={state.commandId}/>
          <div className="auth-field">
            <label htmlFor="register-code" className="auth-label">{t('register.code.label')}</label>
            <input
              key={kept.version}
              ref={input}
              id="register-code"
              name="code"
              type="text"
              dir="ltr"
              className="auth-input"
              defaultValue={kept.code}
              aria-required="true"
              maxLength={64}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              aria-describedby={error ? 'register-code-hint register-error' : 'register-code-hint'}
              aria-invalid={error === 'refused' || error === 'empty' ? true : undefined}
            />
            <p id="register-code-hint" className="auth-hint">{t('register.code.hint')}</p>
          </div>
          <Button variant="primary" type="submit" className="auth-submit" aria-disabled={pending ? true : undefined} onClick={guard}>{t('register.submit')}</Button>
          <p className="auth-hint auth-status" role="status">{pending ? t('register.pending') : null}</p>
        </form>
        <p className="auth-hint auth-nocode">{t('register.noCode')}</p>
        <form action={() => attemptSwitch(switchAccount)} className="auth-switch">
          <Button variant="quiet" type="submit">{t('register.switch')}</Button>
        </form>
      </section>
    </main>
  );
}
