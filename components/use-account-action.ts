'use client';

import {useActionState, useRef} from 'react';
import {accountActionIdle, attemptAccountAction, type AccountAction, type AccountActionState} from '@/lib/account-admin';

/**
 * An Accounts action's state, whether it is running, and the `action` and `onSubmit` for its form (Story 1.5). A second press
 * while one is running is harmless: the lock is taken synchronously in the submit event, before React has re-rendered with
 * `pending`, so a fast double click sends one request. `after` sees each answer once it has come (the list hears of a change
 * there, and may return what the control keeps instead).
 */
export function useAccountAction(
  action: AccountAction,
  after?: (next: AccountActionState, formData: FormData) => AccountActionState,
) {
  const running = useRef(false);
  const [state, formAction, pending] = useActionState(async (previous: AccountActionState, formData: FormData) => {
    try {
      const next = await attemptAccountAction(action, previous, formData);
      return after ? after(next, formData) : next;
    } finally {
      running.current = false;
    }
  }, accountActionIdle);
  const onSubmit = (event: {preventDefault(): void}) => {
    if (running.current || pending) {
      event.preventDefault();
      return false;
    }
    running.current = true;
    return true;
  };
  return {state, formAction, pending, onSubmit};
}
