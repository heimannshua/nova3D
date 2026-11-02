'use client';

import {useActionState, useEffect, useRef, useState} from 'react';
import {cancelJobAction} from '@/app/progress/actions';
import {useI18n} from '@/lib/i18n/react';
import {attemptJobCancel, cancelFailureKey, jobCancelIdle, newCommandId, type JobCancelState} from '@/lib/job-view';
import {Button} from '../ui/button';
import {Dialog} from '../ui/dialog';
import {Notice} from '../ui/states';

/**
 * "Cancel this job?": a confirmation before anything is sent. It says what cancelling does (the work stops now and no new step starts, what you approved stays as it is, money
 * held for requests that were never sent is returned and a request that was already sent may still be charged), and starts on "Keep it" so Enter does not cancel by accident.
 *
 * The form carries the Job and a command ID and nothing about the Account (the server takes that from the verified session). The command ID is made when the dialog opens, so it is
 * one for each confirmation: pressing the button again after an answer was lost sends the same command and the database answers its receipt. While the request is out nothing closes the
 * dialog, so its result cannot be lost; "Keep it" is aria-disabled then. A cancellation closes it and says so (the page behind it shows the Job as cancelled); every other answer
 * keeps it open with the message that explains it.
 */
export function JobCancelDialog({jobId, onCancelled, onClose}: {jobId: string; onCancelled: () => void; onClose: () => void}) {
  const {t} = useI18n();
  const running = useRef(false);
  // One command ID for this confirmation (this dialog is mounted only while it is open).
  const [commandId] = useState(() => newCommandId());

  const [state, formAction, pending] = useActionState(async (previous: JobCancelState, formData: FormData) => {
    try {
      return await attemptJobCancel(cancelJobAction, previous, formData);
    } finally {
      running.current = false;
    }
  }, jobCancelIdle);

  // The parent's callbacks, read when an answer comes and not when they change, so a cancellation is reported once.
  const callbacks = useRef({onCancelled, onClose});
  useEffect(() => {
    callbacks.current = {onCancelled, onClose};
  });
  useEffect(() => {
    if (state.outcome === 'cancelled') {
      callbacks.current.onCancelled();
      callbacks.current.onClose();
    }
  }, [state]);

  const failure = cancelFailureKey(state);
  const busy = () => running.current || pending;
  const close = () => {
    if (!busy()) onClose();
  };

  return (
    <Dialog title={t('job.cancel.title')} description={t('job.cancel.body')} eyebrow={t('job.eyebrow')} onClose={close} locked={pending}>
      <form
        action={formAction}
        onSubmit={(event) => {
          if (running.current || pending) {
            event.preventDefault();
            return;
          }
          running.current = true;
        }}
        noValidate
        className="invite-form job-cancel-form"
      >
        <input type="hidden" name="jobId" value={jobId}/>
        <input type="hidden" name="commandId" value={commandId}/>
        <p className="project-muted">{t('job.cancel.cost')}</p>
        {!pending && failure ? (
          <div className="invite-notice">
            <Notice tone={state.outcome === 'not_cancellable' ? 'warning' : 'danger'} role="alert">{t(failure)}</Notice>
          </div>
        ) : null}
        <div className="dialog-actions">
          <Button variant="secondary" data-autofocus="" aria-disabled={pending ? true : undefined} onClick={close}>{t('job.cancel.keep')}</Button>
          <Button variant="danger" type="submit" aria-disabled={pending ? true : undefined}>{t('job.cancel.confirm')}</Button>
        </div>
        <p className="auth-hint auth-status" role="status">{pending ? t('job.cancel.pending') : null}</p>
      </form>
    </Dialog>
  );
}
