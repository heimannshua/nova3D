'use client';

import {useActionState, useRef} from 'react';
import {attemptUsageAction, usageActionIdle, type UsageAction, type UsageActionState} from '@/lib/usage-view';

/**
 * A Usage action's state, whether it is running, and the `action` and `onSubmit` for its form (Story 2.4). A second press while one is
 * running is harmless: the lock is taken synchronously in the submit event, before React has re-rendered with `pending`, so a fast double
 * click sends one request (and a press that does get through sends the same command ID, which the database answers as a replay).
 * `after` sees each answer once it has come (the card hears of a change there, and may return what the control keeps instead).
 */
export function useUsageAction(
  action: UsageAction,
  after?: (next: UsageActionState, formData: FormData) => UsageActionState,
) {
  const running = useRef(false);
  const [state, formAction, pending] = useActionState(async (previous: UsageActionState, formData: FormData) => {
    try {
      const next = await attemptUsageAction(action, previous, formData);
      return after ? after(next, formData) : next;
    } finally {
      running.current = false;
    }
  }, usageActionIdle);
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
