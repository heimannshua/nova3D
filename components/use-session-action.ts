'use client';

import {useActionState, useRef} from 'react';
import {attemptSessionAction, sessionActionIdle, type SessionAction, type SessionActionState} from '@/lib/session-actions';

/**
 * A sign-out button's action: the state it answered, whether it is running, the `action` and `onSubmit` for
 * its form. A second press while one is running is harmless: the lock is taken synchronously in the submit
 * event, before React has re-rendered with `pending`, so a fast double click sends one request.
 */
export function useSessionAction(action: SessionAction) {
  const running = useRef(false);
  const [state, formAction, pending] = useActionState(async (previous: SessionActionState) => {
    try {
      return await attemptSessionAction(action, previous);
    } finally {
      running.current = false;
    }
  }, sessionActionIdle);
  const onSubmit = (event: {preventDefault(): void}) => {
    if (running.current || pending) {
      event.preventDefault();
      return;
    }
    running.current = true;
  };
  return {state, formAction, pending, onSubmit};
}
