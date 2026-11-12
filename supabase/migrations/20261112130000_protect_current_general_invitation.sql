-- Story 1.3 AC-2: only successful redemption retires the current unused general invitation.
-- Readers and seed command understand the additive protected outcome before this migration is applied.

create or replace function api.issue_invitation(p_code_hash text, p_kind text, p_label text, p_actor text, p_replace boolean default false)
returns api.invitation_receipt
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := nullif(btrim(p_label), '');
  v_receipt api.invitation_receipt;
  v_current identity.invitations;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$'
     or p_kind is null or p_kind not in ('named', 'general')
     or (p_kind = 'named' and (v_label is null or length(v_label) > 80))
     or (p_kind = 'general' and v_label is not null)
     or p_actor is null or p_actor !~ '^[a-z][a-z_]*(:[A-Za-z0-9_-]{1,64}){0,2}$' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  v_receipt.kind := p_kind;
  if p_kind = 'general' then
    perform pg_advisory_xact_lock(hashtextextended('invitation:general', 0));
  end if;

  begin
    if p_kind = 'general' then
      select * into v_current from identity.invitations i where i.kind = 'general' and i.status = 'unused' for update;
      if found then
        if not coalesce(p_replace, false) then
          v_receipt.outcome := 'exists';
          v_receipt.invitation_id := v_current.id;
          return v_receipt;
        end if;
        v_receipt.outcome := 'protected';
        v_receipt.invitation_id := v_current.id;
        perform identity.record_audit(p_actor, 'invitation.issue_protected', 'invitation:' || v_current.id::text);
        return v_receipt;
      end if;
    end if;

    insert into identity.invitations (code_hash, kind, label, issued_by)
      values (p_code_hash, p_kind, v_label, p_actor)
      returning id into v_receipt.invitation_id;
    perform identity.record_audit(p_actor, 'invitation.issued', 'invitation:' || v_receipt.invitation_id::text);
  exception when unique_violation then
    v_receipt.outcome := 'exists';
    v_receipt.invitation_id := null;
    v_receipt.replaced_invitation_id := null;
    return v_receipt;
  end;

  v_receipt.outcome := 'issued';
  return v_receipt;
end;
$$;

comment on function api.issue_invitation(text, text, text, text, boolean) is
  'Stores the hash of a named or general invitation code. A current unused general code is protected from replacement with outcome protected.';

create or replace function api.revoke_invitation(p_actor text, p_invitation_id uuid default null, p_code_hash text default null)
returns api.revocation_receipt
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt api.revocation_receipt;
  v_invitation identity.invitations;
begin
  if p_actor is null or p_actor !~ '^[a-z][a-z_]*(:[A-Za-z0-9_-]{1,64}){0,2}$'
     or (p_invitation_id is null) = (p_code_hash is null)
     or (p_code_hash is not null and p_code_hash !~ '^[0-9a-f]{64}$') then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  select * into v_invitation
    from identity.invitations i
   where (p_invitation_id is not null and i.id = p_invitation_id)
      or (p_code_hash is not null and i.code_hash = p_code_hash)
     for update;
  if not found then
    v_receipt.outcome := 'not_found';
    return v_receipt;
  end if;

  v_receipt.invitation_id := v_invitation.id;
  if v_invitation.status = 'unused' and v_invitation.kind = 'general' then
    v_receipt.outcome := 'protected';
    perform identity.record_audit(p_actor, 'invitation.revoke_protected', 'invitation:' || v_invitation.id::text);
  elsif v_invitation.status = 'unused' then
    update identity.invitations i
       set status = 'revoked', revoked_at = clock_timestamp(), revoked_by = p_actor
     where i.id = v_invitation.id;
    perform identity.record_audit(p_actor, 'invitation.revoked', 'invitation:' || v_invitation.id::text);
    v_receipt.outcome := 'revoked';
  elsif v_invitation.status = 'revoked' then
    v_receipt.outcome := 'already_revoked';
  else
    v_receipt.outcome := 'redeemed';
  end if;
  return v_receipt;
end;
$$;

comment on function api.revoke_invitation(text, uuid, text) is
  'Revokes an unused named invitation by ID or hash; a current unused general invitation returns protected and remains unused.';

notify pgrst, 'reload schema';
