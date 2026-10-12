-- Story 1.11: the audit of refused invitation changes.
--
-- The Administrator's invitation page (Story 1.11) issues and revokes codes through api.issue_invitation and
-- api.revoke_invitation, which audit the changes that were made (invitation.issued, invitation.revoked). A change
-- that is refused changes nothing, so those functions never run and never audit it. This migration adds the one
-- function that records the refusal:
--
--   invitation.issue_refused   an Administrator tried to issue a code (named, or the general one) with no valid
--                              fresh-authentication marker
--   invitation.revoke_refused  an Administrator tried to revoke a code with no valid marker
--   invitation.denied          an Account that is not an Administrator tried to do either
--
-- The check that decides whether a change is refused is made by the application, in the Server Action, before it
-- calls api.issue_invitation or api.revoke_invitation (the audited seed command shares those two functions and has no
-- session, so the check cannot live in them). This function only records what the application decided, and so it
-- checks the one thing it can: that the account the application names is a real one, and that the refusal it
-- records is the kind that account can make (only an Administrator is "refused for want of a marker", and only an
-- Account that is not an Administrator is "denied").
--
-- What is recorded is who (user:<Auth user ID>), what (one of the three actions) and, for an attempt to revoke, which
-- invitation (invitation:<ID>), and when. Never a label, a code, a hash, a marker outcome or any reason text: the
-- audit table has no column for content and this function accepts none. The invitation is recorded as the target
-- only when it exists; an ID that names nothing is recorded as an attempt with no target, so a caller that keeps
-- inventing IDs cannot grow the append-only table. The same actor, action and target is recorded at most once an
-- hour (identity.record_audit_once), and the check is made under an advisory lock, so two refusals at the same
-- moment are one row.
--
-- Same pattern as the earlier migrations: the function is in the `api` schema, runs as the table owner, and only
-- service_role may execute it; it is closed by default (the default-privileges rules of 20261010120000_accounts.sql)
-- and granted by name at the end. It adds no table.

create type api.invitation_refusal as (outcome text);

-- recorded | repeated (the same refusal was already recorded in the last hour; nothing was written)
create function api.record_invitation_refusal(p_user_id uuid, p_action text, p_invitation_id uuid default null)
returns api.invitation_refusal
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.invitation_refusal;
  v_role text;
  v_actor text;
  v_target text;
  v_seen boolean;
begin
  if p_user_id is null or p_action is null
     or p_action not in ('invitation.issue_refused', 'invitation.revoke_refused', 'invitation.denied')
     or (p_action = 'invitation.issue_refused' and p_invitation_id is not null) then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  select a.role into v_role from identity.accounts a where a.user_id = p_user_id;
  -- No such Account, or a refusal of the wrong kind for it: an Administrator is never "denied", and an Account
  -- that is not an Administrator is never "refused for want of a marker".
  if not found or (p_action = 'invitation.denied') = (v_role = 'administrator') then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  v_actor := 'user:' || p_user_id::text;
  if p_invitation_id is not null and exists (select 1 from identity.invitations i where i.id = p_invitation_id) then
    v_target := 'invitation:' || p_invitation_id::text;
  end if;

  -- One refusal at a time per actor, action and target, so "at most once an hour" holds under concurrency too.
  perform pg_advisory_xact_lock(hashtextextended('invitation_refusal:' || v_actor || ':' || p_action || ':' || coalesce(v_target, ''), 0));
  v_seen := exists (
    select 1 from identity.audit_events e
     where e.actor = v_actor and e.action = p_action and e.target is not distinct from v_target
       and e.occurred_at > clock_timestamp() - interval '1 hour'
  );
  perform identity.record_audit_once(v_actor, p_action, v_target);
  v_result.outcome := case when v_seen then 'repeated' else 'recorded' end;
  return v_result;
end;
$$;

comment on function api.record_invitation_refusal(uuid, text, uuid) is
  'Records a refused invitation change (invitation.issue_refused, invitation.revoke_refused or invitation.denied) for an Account: the actor, and for a revoke the invitation as target when it exists. At most once an hour per actor, action and target. Never content. recorded | repeated.';

-- Access ------------------------------------------------------------------------------------------------

-- Closed by default; only the service role is let in, by name.
grant execute on function api.record_invitation_refusal(uuid, text, uuid) to service_role;

-- A new function and a new type: have the Data API reload its schema cache now.
notify pgrst, 'reload schema';
