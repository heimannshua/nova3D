'use client';

import {useEffect, useId, useRef, type ReactNode} from 'react';
import {Button, IconButton, type ButtonVariant} from './button';
import {useI18n} from '@/lib/i18n/react';

/**
 * A modal built on the native <dialog>. The browser supplies the focus trap, the Escape key and the
 * inert page behind it; this adds focus return to the opener and a click-outside close.
 * Mount it only while it is open. Mark the control that should take focus first with data-autofocus.
 */
export function Dialog({title, description, eyebrow, closeLabel, onClose, children, className}: {
  title: string;
  description?: string;
  eyebrow?: string;
  /** When given, a close button is shown in the header. Escape and a click outside always close it too. */
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  // Whether the press that ended in this click began on the backdrop itself. A text selection dragged out of
  // the dialog ends on the backdrop, and the click lands on the dialog element, but it must not close it.
  const pressedOnBackdrop = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const closed = () => onCloseRef.current();
    dialog.addEventListener('close', closed);
    return () => {
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
        if (closing) ref.current?.close();
      }}
    >
      <div className="dialog-body">
        <div className="dialog-header">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h2 id={titleId} className="dialog-title">{title}</h2>
          </div>
          {closeLabel ? <IconButton icon="close" label={closeLabel} onClick={() => ref.current?.close()}/> : null}
        </div>
        {description ? <p id={descriptionId} className="dialog-description">{description}</p> : null}
        {children}
      </div>
    </dialog>
  );
}

/** A yes/no question. For a destructive action focus starts on Cancel, so Enter does not destroy by accident. */
export function ConfirmDialog({title, description, confirmLabel, cancelLabel, tone = 'primary', onConfirm, onCancel}: {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: Extract<ButtonVariant, 'primary' | 'danger'>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const {t} = useI18n();
  return (
    <Dialog title={title} description={description} onClose={onCancel}>
      <div className="dialog-actions">
        <Button variant="secondary" data-autofocus={tone === 'danger' ? '' : undefined} onClick={onCancel}>{cancelLabel ?? t('confirm.cancel')}</Button>
        <Button variant={tone} data-autofocus={tone === 'danger' ? undefined : ''} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Dialog>
  );
}
