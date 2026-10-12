'use client';

import {useEffect, useId, useRef, useState} from 'react';
import {useI18n} from '@/lib/i18n/react';
import type {IssuedCode} from '@/lib/invitations';
import {Button} from '../ui/button';
import {Notice} from '../ui/states';
import {LtrToken} from '../ui/text-span';

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * A code that was just made, shown once (AD-01, Story 1.11), with a copy action. The code lives in the browser's
 * memory only, in this component's props: it is not in the address, a cookie, the browser's storage or the
 * router's cache, and once the person hides it (or leaves the page) it cannot be shown again. Focus moves here when
 * it appears, so a keyboard or screen reader user lands on the one thing that cannot be recovered.
 *
 * Copy uses the clipboard; where that is refused (an insecure context, a denied permission) the code is selected
 * so the person can copy it by hand, and the message says so.
 */
export function CodeReveal({item, onHide}: {item: IssuedCode; onHide: () => void}) {
  const {t} = useI18n();
  const headingId = useId();
  const onceId = useId();
  const section = useRef<HTMLElement>(null);
  const value = useRef<HTMLElement>(null);
  const [copy, setCopy] = useState<CopyState>('idle');

  useEffect(() => {
    section.current?.focus();
  }, []);

  const select = () => {
    const node = value.current;
    const selection = window.getSelection();
    if (!node || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(item.code);
      setCopy('copied');
    } catch {
      select();
      setCopy('failed');
    }
  };

  const named = item.kind === 'named';
  return (
    <section ref={section} tabIndex={-1} className="code-reveal" aria-labelledby={headingId} aria-describedby={onceId}>
      <p className="eyebrow">{t('invitations.reveal.eyebrow')}</p>
      <h2 id={headingId}>{named ? t('invitations.reveal.named', {label: item.label ?? ''}) : t('invitations.reveal.general')}</h2>
      {item.replacedInvitationId ? <div className="invite-notice"><Notice tone="info">{t('invitations.reveal.rotated')}</Notice></div> : null}
      <p id={onceId} className="settings-help">{t('invitations.reveal.once')}</p>
      <p className="code-reveal-label">{t('invitations.reveal.codeLabel')}</p>
      <p className="code-reveal-value">
        <LtrToken><code ref={value}>{item.code}</code></LtrToken>
      </p>
      <div className="code-reveal-actions">
        <Button variant="primary" onClick={copyCode}>{t('invitations.reveal.copy')}</Button>
        <Button variant="secondary" onClick={onHide}>{t('invitations.reveal.hide')}</Button>
      </div>
      <p className="settings-help" role="status">
        {copy === 'copied' ? t('invitations.reveal.copied') : copy === 'failed' ? t('invitations.reveal.copyFailed') : null}
      </p>
    </section>
  );
}
