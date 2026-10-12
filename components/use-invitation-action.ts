'use client';

import {useActionState, useRef} from 'react';
import {attemptInvitationAction, invitationActionIdle, type InvitationAction, type InvitationActionState} from '@/lib/invitations';

/**
 * An invitation action's state, whether it is running, and the `action` and `onSubmit` for its form (Story 1.11).
 * A second press while one is running is harmless: the lock is taken synchronously in the submit event, before React
 * has re-rendered with `pending`, so a fast double click sends one request. `after` sees each answer once it has
 * come (a form hands a made code to the page there, and returns what the form keeps instead).
 */
export function useInvitationAction(
  action: InvitationAction,
  after?: (next: InvitationActionState, formData: FormData) => InvitationActionState,
) {
  const running = useRef(false);
  const [state, formAction, pending] = useActionState(async (previous: InvitationActionState, formData: FormData) => {
    try {
      const next = await attemptInvitationAction(action, previous, formData);
      return after ? after(next, formData) : next;
    } finally {
      running.current = false;
    }
  }, invitationActionIdle);
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
