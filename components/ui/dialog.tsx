'use client';

import {useEffect, useId, useRef, type ReactNode} from 'react';
import {Button, IconButton, type ButtonVariant} from './button';
import {useI18n} from '@/lib/i18n/react';

/**
 * A modal built on the native <dialog>. The browser supplies the focus trap, the Escape key and the
 * inert page behind it; this adds focus return to the opener and a click-outside close.
 * Mount it only while it is open. Mark the control that should take focus first with data-autofocus.
 *
 * `locked` is for a dialog whose work is in flight (a rename being saved): while it is true NO way closes it, so its result and
 * any error cannot be lost. Escape is cancelled, a click outside does nothing, and if the browser closes it anyway (a second
 * Escape in a row skips the cancel event) it is opened again at once and `onClose` is not called.
 */
export function Dialog({title, description, eyebrow, closeLabel, onClose, children, className, locked = false}: {
  title: string;
  description?: string;
  eyebrow?: string;
  /** When given, a close button is shown in the header. Escape and a click outside always close it too (unless `locked`). */
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  locked?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const lockedRef = useRef(locked);
  // Whether the press that ended in this click began on the backdrop itself. A text selection dragged out of
  // the dialog ends on the backdrop, and the click lands on the dialog element, but it must not close it.
  const pressedOnBackdrop = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
    lockedRef.current = locked;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const cancelled = (event: Event) => {
      if (lockedRef.current) event.preventDefault();
    };
    const closed = () => {
      if (lockedRef.current) {
        // Closed in spite of the cancel (the browser lets a second Escape through): put it back, and say nothing.
        if (!dialog.open) dialog.showModal();
        return;
      }
      onCloseRef.current();
    };
    dialog.addEventListener('cancel', cancelled);
    dialog.addEventListener('close', closed);
    return () => {
      dialog.removeEventListener('cancel', cancelled);
      dialog.removeEventListener('close', closed);
      if (dialog.open) dialog.close();
      opener?.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={['dialog', className].filter(Boolean).join(' ')}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onPointerDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const closing = event.target === event.currentTarget && pressedOnBackdrop.current;
        pressedOnBackdrop.current = false;
        if (closing && !lockedRef.current) ref.current?.close();
      }}
    >
      <div className="dialog-body">
        <div className="dialog-header">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h2 id={titleId} className="dialog-title">{title}</h2>
          </div>
          {closeLabel ? <IconButton icon="close" label={closeLabel} aria-disabled={locked ? true : undefined} onClick={() => !lockedRef.current && ref.current?.close()}/> : null}
        </div>
        {description ? <p id={descriptionId} className="dialog-description">{description}</p> : null}
        {children}
      </div>
    </dialog>
  );
}

/**
 * A yes/no question. For a destructive action focus starts on Cancel, so Enter does not destroy by accident. `startOn`
 * says it for a question that is not destructive but still should not be answered by accident (default: Cancel for the
 * `danger` tone, the confirming button otherwise).
 */
export function ConfirmDialog({title, description, confirmLabel, cancelLabel, tone = 'primary', startOn, onConfirm, onCancel}: {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: Extract<ButtonVariant, 'primary' | 'danger'>;
  startOn?: 'cancel' | 'confirm';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const {t} = useI18n();
  const focusCancel = (startOn ?? (tone === 'danger' ? 'cancel' : 'confirm')) === 'cancel';
  return (
    <Dialog title={title} description={description} onClose={onCancel}>
      <div className="dialog-actions">
        <Button variant="secondary" data-autofocus={focusCancel ? '' : undefined} onClick={onCancel}>{cancelLabel ?? t('confirm.cancel')}</Button>
        <Button variant={tone} data-autofocus={focusCancel ? undefined : ''} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Dialog>
  );
}
