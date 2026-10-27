'use client';

import {useId, useState} from 'react';
import type {PermissionActionState} from '@/app/projects/[projectId]/provider-permissions/actions';

/** Disclosure control for upcoming paid-category actions. Grant stays opt-in until a specific Job and price quote exist. */
export function PaidPermissionPanel({provider, purpose, data, retention, maximum, canGrant = false, granted = false, disabledReason = 'A paid Job and verified rate schedule are not available yet.', onGrant, onRevoke}: {
  provider: string; purpose: string; data: readonly string[]; retention: string; maximum: string;
  canGrant?: boolean; granted?: boolean; disabledReason?: string; onGrant?: () => Promise<PermissionActionState>; onRevoke?: () => Promise<PermissionActionState>;
}) {
  const title = useId();
  const [busy, setBusy] = useState(false);
  const [localGrant, setLocalGrant] = useState<{source: boolean; value: boolean} | null>(null);
  const isGranted = localGrant?.source === granted ? localGrant.value : granted;
  const [error, setError] = useState(false);
  const [actionReason, setActionReason] = useState<string | null>(null);
  async function change(action: (() => Promise<PermissionActionState>) | undefined, next: boolean) {
    if (!action || busy) return;
    setBusy(true); setError(false);
    try {
      const result = await action();
      if (result.outcome === 'saved' || result.outcome === 'revoked') { setLocalGrant({source: granted, value: next}); setActionReason(null); }
      else { setError(true); setActionReason(result.reason ?? result.outcome); }
    } catch { setError(true); } finally { setBusy(false); }
  }
  return <section className="section" aria-labelledby={title}>
    <h2 id={title}>Paid provider permission</h2>
    <dl className="project-facts">
      <div><dt>Provider</dt><dd>{provider}</dd></div>
      <div><dt>Purpose</dt><dd>{purpose}</dd></div>
      <div><dt>Data sent</dt><dd>{data.join(', ')}</dd></div>
      <div><dt>Retention and deletion</dt><dd>{retention}</dd></div>
      <div><dt>Highest charge for one request</dt><dd>{maximum}</dd></div>
    </dl>
    <p>Permission is off until you grant it. It applies only to this project and job, and expires when the job ends or after seven days. You can revoke it at any time.</p>
    {error ? <p role="alert">Permission could not be saved. Try again.</p> : null}
    {isGranted
      ? <button type="button" disabled={busy} onClick={() => void change(onRevoke, false)}>Revoke permission</button>
      : <button type="button" disabled={!canGrant || busy} onClick={() => void change(onGrant, true)}>Grant permission</button>}
    {!isGranted && !canGrant ? <p>{disabledReason}</p> : null}
    {actionReason ? <p role="status">Permission was not changed: {actionReason}.</p> : null}
  </section>;
}
