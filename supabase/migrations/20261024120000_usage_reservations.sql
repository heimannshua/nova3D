-- Story 2.6: reserve bounded costs atomically.
--
-- Nothing bounded what paid work may cost. Settled and reserved amounts were a stand-in (Story 2.4), no rate was recorded and no external operation was reserved,
-- so concurrent work could overspend, a duplicate could reserve twice, and an overrun or an uncertain charge had nowhere to be recorded. Stories 2.5, 2.7, 2.8 and
-- 2.14 build on the calculator, the ledgers and the admission this migration adds to the closed `usage` schema. There is no screen, provider adapter, dispatch or
-- worker yet.
--
--   usage.rate_schedules          immutable, versioned rate schedules: GLOBAL (not Account-owned), a provider, a model, an API version, a currency, the input, output and
--                                 request rates each as a numerator and a denominator of microdollars per unit, the billing increments and a geography multiplier.
--                                 Written by no `api` function and no application code: a real environment has none until Story 2.5 adds the writer (the tests insert
--                                 as the owner). Update and truncate are refused.
--   usage.reservations            the append-only reservation ledger: ONE row for each external operation (unique), pinned to the rate schedule, the provider, the
--                                 requested model and the API version, with the three calculator inputs, the input bound and the reserved amount. Update and
--                                 truncate are refused.
--   usage.settlements             the append-only settlement ledger: ONE row for each reservation (unique), classified `evidence`, `deadline`, `noncharge` or
--                                 `unused`, which always releases the reservation's whole amount and settles what happened. Update and truncate are refused.
--   usage.overrun_incidents       usage evidence above a reservation: written by api.settle_cost only, clearable once (by Story 2.8), changed in no other way.
--   usage.commands                the immutable receipt of each reserve or settle command, by (Account, command ID).
--   usage.input_bound, usage.price  THE CALCULATOR, one implementation used by quote, reserve and settle alike: exact integers and rationals (`numeric` holds only
--                                 integers here), rounded up ONCE per operation. usage.bound_cost is the quote's judgement (the reasons it refuses).
--   usage.job_exposure            the Job's exposure over every reservation of every attempt: the settled amount where settled, the reserved amount where not.
--   usage.period_figures          re-created: the figures of a period are SIGNED DELTAS from the ledgers (usage.fixture_figures is dropped).
--   usage.* constant functions    the recorded constants, changeable only by a recorded decision; lib/usage-reservations.ts mirrors them and a test holds the two equal.
--   api.quote_cost                read-only: the input bound, the billed units and the microdollars of a request, or why no bound is available. Takes no lock.
--   api.reserve_cost              the admission: reserves one operation's enforceable maximum against every limit in one transaction.
--   api.settle_cost               settles a reservation: records what happened or releases what never went out. No Account epoch, status or Project check.
--   api.preflight                 re-created carrying every earlier probe but the fixture table's, and the new ones (fifty `api` functions in all).
--
-- MONEY is integer USD microdollars: `bigint` here, a safe integer in TypeScript, never a float; every intermediate is an exact `numeric` (an integer). A single
-- amount is from 1 to 1e15 microdollars. The calculator:
--   input bound  = ceil((request_bytes + 2000 + 5000 x images) x 11 / 10)            (a 10% margin; the bytes are those of the request with image data excluded)
--   billed units = the tokens rounded up to the schedule's increment, separately for input and output
--   price        = ceil(((input units x input rate) + (output units x output rate) + (requests x request rate)) x multiplier), over a common denominator in
--                  integers and rounded up ONCE; above 1e15 it is `overflow`, and one that prices nothing is `unpriced`.
--
-- The admission (api.reserve_cost), in this order. A refusal writes no reservation, settlement, incident or receipt; the month may turn first (usage.ensure_period, step 5,
-- runs before the gates, as the story orders it, and appends the `month` period when work is first asked for in a new UTC month):
--   1. the arguments (22023);                                                   2. identity.assert_operation_authority (`denied`);
--   3. the advisory lock `nova3d:usage-command:<account>:<command>`;            4. the operation belongs to the Account and its Project is held FOR SHARE (`unavailable`);
--   5. the advisory lock `nova3d:usage:<account>` and usage.ensure_period;      6. the receipt by (Account, command ID): `replayed` | `reused`;
--   7. the operation already holds a reservation: `replayed` (recorded) | `already_reserved`;
--   8. the operation is not `planned`: `not_reservable`;                         9. the calculator: `unavailable_bound`;
--  10. a provider with an uncleared incident: `provider_blocked`;              11. `over_operation_cap`; 12. `over_job_cap`; 13. `insufficient_allowance`;
--  14. otherwise one reservation in the current period and a receipt: `reserved`.
-- Replays and gates run BEFORE state checks, so a lost answer always replays. Every money refusal carries the exact cost block (requested, the cap or limit, what
-- is used, what is available).
--
-- Stable error codes: 22023 (arguments), 55000 (a record refuses a change), 23514 (a row is not shaped as the ledger requires).
--
-- Same pattern as the earlier migrations: the functions in `api` run as the table owner with an empty search_path, are closed by default (the default-privileges
-- rules of 20261010120000_accounts.sql) and granted to service_role by name at the end; the functions in `usage` are callable by no API role at all.

-- The recorded constants ------------------------------------------------------------------------------------------------------------------

-- Changeable only by a recorded decision. lib/usage-reservations.ts mirrors every one, and a test holds the two equal.
create function usage.overhead_tokens() returns integer language sql immutable set search_path = '' as $$ select 2000 $$;
create function usage.image_tokens() returns integer language sql immutable set search_path = '' as $$ select 5000 $$;
create function usage.margin_percent() returns integer language sql immutable set search_path = '' as $$ select 10 $$;
create function usage.input_ceiling() returns integer language sql immutable set search_path = '' as $$ select 200000 $$;
create function usage.output_ceiling() returns integer language sql immutable set search_path = '' as $$ select 16000 $$;
create function usage.request_ceiling() returns integer language sql immutable set search_path = '' as $$ select 20 $$;
create function usage.operation_cap() returns bigint language sql immutable set search_path = '' as $$ select 1000000::bigint $$;
create function usage.job_cap() returns bigint language sql immutable set search_path = '' as $$ select 5000000::bigint $$;
create function usage.ambiguity_deadline() returns interval language sql immutable set search_path = '' as $$ select interval '24 hours' $$;

comment on function usage.overhead_tokens() is 'Fixed overhead added to the input bound: 2,000 tokens. A recorded constant. Callable by no API role.';
comment on function usage.image_tokens() is 'Tokens added to the input bound for each image: 5,000. A recorded constant. Callable by no API role.';
comment on function usage.margin_percent() is 'The margin the input bound is raised by: 10 percent. A recorded constant. Callable by no API role.';
comment on function usage.input_ceiling() is 'Admission ceiling of input tokens, applied to the raised bound: 200,000. A recorded constant. Callable by no API role.';
comment on function usage.output_ceiling() is 'Admission ceiling of output tokens: 16,000. A recorded constant. Callable by no API role.';
comment on function usage.request_ceiling() is 'Admission ceiling of requests of one operation: 20. A recorded constant. Callable by no API role.';
comment on function usage.operation_cap() is 'The most one external operation may reserve: 1,000,000 microdollars ($1). A recorded constant. Callable by no API role.';
comment on function usage.job_cap() is 'The most one Job may hold across all its attempts: 5,000,000 microdollars ($5). A recorded constant. Callable by no API role.';
comment on function usage.ambiguity_deadline() is 'How long an ambiguous charge holds its reservation before it settles at the reservation: 24 hours. A recorded constant. Callable by no API role.';

-- The calculator: the input bound and the billed units ---------------------------------------------------------------------------------

-- ceil((request_bytes + 2000 + 5000 x images) x 11 / 10): the byte length of the request with image data excluded (no token is shorter than a byte), the fixed
-- overhead and the tokens of each image, raised by the margin. Exact: the sum is an integer, and the ceiling of a quotient of integers is an integer division.
create function usage.input_bound(p_request_bytes bigint, p_image_count integer) returns numeric
language sql
immutable
set search_path = ''
as $$
  select div(
    (p_request_bytes::numeric + usage.overhead_tokens() + usage.image_tokens() * p_image_count::numeric) * (100 + usage.margin_percent()) + 99,
    100)
$$;

comment on function usage.input_bound(bigint, integer) is
  'The provider-independent input bound in tokens: ceil((request bytes + 2000 + 5000 x images) x 11 / 10), exact. The one implementation, used by quote, reserve and settle alike. Callable by no API role.';

-- Tokens rounded up to a billing increment. Tokens, not money: the one round-up of MONEY is usage.price.
create function usage.billed_units(p_tokens numeric, p_increment integer) returns numeric
language sql
immutable
set search_path = ''
as $$
  select div(p_tokens + p_increment - 1, p_increment) * p_increment
$$;

comment on function usage.billed_units(numeric, integer) is
  'Tokens rounded up to a billing increment (1 to 1,000,000). Callable by no API role.';

-- The rate schedules (global, immutable) ----------------------------------------------------------------------------------------------

create table usage.rate_schedules (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider ~ '^[a-z][a-z0-9._-]{0,79}$'),
  model text not null check (model ~ '^[a-z][a-z0-9._-]{0,79}$'),
  -- A version of the provider's rates, from 1: a rate that changes is a new version, never an edit.
  version integer not null check (version >= 1),
  -- The provider's API version: printable ASCII without spaces.
  api_version text not null check (api_version ~ '^[!-~]{1,100}$'),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- Microdollars per token (input and output) or per request: a rational, numerator over denominator.
  input_rate_num bigint not null check (input_rate_num between 0 and 1000000000000),
  input_rate_den bigint not null check (input_rate_den between 1 and 1000000000000),
  output_rate_num bigint not null check (output_rate_num between 0 and 1000000000000),
  output_rate_den bigint not null check (output_rate_den between 1 and 1000000000000),
  request_rate_num bigint not null check (request_rate_num between 0 and 1000000000000),
  request_rate_den bigint not null check (request_rate_den between 1 and 1000000000000),
  -- The billing increments, in tokens: billed units are rounded up to a multiple of each.
  input_increment integer not null check (input_increment between 1 and 1000000),
  output_increment integer not null check (output_increment between 1 and 1000000),
  -- The geography multiplier, a rational of at least 1 (1.0 unless the schedule records another).
  multiplier_num bigint not null check (multiplier_num between 1 and 1000000000000),
  multiplier_den bigint not null check (multiplier_den between 1 and 1000000000000),
  created_at timestamptz not null default clock_timestamp(),
  constraint rate_schedules_provider_model_version_key unique (provider, model, version),
  constraint rate_schedules_multiplier_shape check (multiplier_num >= multiplier_den)
);

comment on table usage.rate_schedules is
  'Immutable, versioned rate schedules (Story 2.6): global, not Account-owned. Written by no api function and no application code; a real environment has none until Story 2.5 adds the writer. Update and truncate are refused; delete is left for no one but the owner.';

-- The records that are never edited (a schedule, a reservation, a settlement, a receipt) refuse update and truncate. Delete is left for the Epic 8 purge.
create function usage.refuse_record_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'usage.%: a record is not edited or emptied', tg_table_name using errcode = '55000';
end;
$$;

create trigger rate_schedules_no_update before update on usage.rate_schedules
  for each row execute function usage.refuse_record_change();
create trigger rate_schedules_no_truncate before truncate on usage.rate_schedules
  for each statement execute function usage.refuse_record_change();

-- The keys the ledgers use for ownership by composite foreign keys (additive; no Jobs function or row changes) -----------------------------

alter table usage.periods add constraint periods_id_account_key unique (id, account_id);
alter table jobs.operations add constraint operations_id_account_key unique (id, account_id);

-- The reservations -------------------------------------------------------------------------------------------------------------------------

create table usage.reservations (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT throughout: an Account that has ledger rows cannot be deleted by accident; the Epic 8 purge removes them first.
  account_id uuid not null references identity.accounts (id) on delete restrict,
  -- The allowance period the reservation was made in. A later settlement may fall in a later period.
  period_id uuid not null,
  job_id uuid not null,
  -- ONE reservation for each external operation.
  operation_id uuid not null,
  -- The pins of the operation's receipt: the schedule, the provider, the requested model and the API version.
  rate_schedule_id uuid not null references usage.rate_schedules (id) on delete restrict,
  provider text not null check (provider ~ '^[a-z][a-z0-9._-]{0,79}$'),
  requested_model text not null check (requested_model ~ '^[a-z][a-z0-9._-]{0,79}$'),
  api_version text not null check (api_version ~ '^[!-~]{1,100}$'),
  -- The three inputs of the calculator, and its input bound (checked against the calculator).
  request_bytes bigint not null check (request_bytes >= 0),
  image_count integer not null check (image_count >= 0),
  output_limit integer not null check (output_limit >= 0),
  input_bound bigint not null check (input_bound >= 1),
  -- The enforceable upper bound of the operation's cost, in microdollars.
  reserved_microdollars bigint not null check (reserved_microdollars between 1 and 1000000000000000),
  -- SHA-256 of what the reserving command asked for (usage.cost_digest), so a replay can be told from a reuse.
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  constraint reservations_period_fkey foreign key (period_id, account_id) references usage.periods (id, account_id) on delete restrict,
  constraint reservations_job_fkey foreign key (job_id, account_id) references jobs.jobs (id, account_id) on delete restrict,
  constraint reservations_operation_fkey foreign key (operation_id, account_id) references jobs.operations (id, account_id) on delete restrict,
  constraint reservations_operation_key unique (operation_id),
  constraint reservations_id_account_key unique (id, account_id),
  constraint reservations_bound_shape check (input_bound = usage.input_bound(request_bytes, image_count))
);

comment on table usage.reservations is
  'The append-only reservation ledger (Story 2.6): one row for each external operation, pinned to its rate schedule, provider, requested model and API version, with the calculator inputs, the input bound and the reserved amount. Update and truncate are refused; delete is left for the Epic 8 purge.';

create index reservations_period_idx on usage.reservations (period_id);
create index reservations_job_idx on usage.reservations (job_id, account_id);
create index reservations_schedule_idx on usage.reservations (rate_schedule_id);

-- A reservation is for an operation of its Job, and its pins are its schedule's.
create function usage.check_reservation() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_schedule usage.rate_schedules;
begin
  select * into v_schedule from usage.rate_schedules s where s.id = new.rate_schedule_id;
  if not found or v_schedule.provider <> new.provider or v_schedule.model <> new.requested_model or v_schedule.api_version <> new.api_version then
    raise exception 'usage.reservations: the provider, model and API version are those of the rate schedule' using errcode = '23514';
  end if;
  if not exists (
       select 1
         from jobs.operations o
         join jobs.steps s on s.id = o.step_id and s.account_id = o.account_id
         join jobs.attempts a on a.id = s.attempt_id and a.account_id = s.account_id
        where o.id = new.operation_id and o.account_id = new.account_id and a.job_id = new.job_id) then
    raise exception 'usage.reservations: the operation belongs to the Job' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger reservations_check before insert on usage.reservations
  for each row execute function usage.check_reservation();
create trigger reservations_no_update before update on usage.reservations
  for each row execute function usage.refuse_record_change();
create trigger reservations_no_truncate before truncate on usage.reservations
  for each statement execute function usage.refuse_record_change();

-- The settlements --------------------------------------------------------------------------------------------------------------------------

create table usage.settlements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references identity.accounts (id) on delete restrict,
  -- ONE settlement for each reservation.
  reservation_id uuid not null,
  -- The period the settlement was made in: the current one at that moment, which may be later than the reservation's.
  period_id uuid not null,
  -- evidence: usage evidence priced by the calculator. deadline: an ambiguous charge past 24 hours, settled at the reservation. noncharge: a definitive pre-processing
  -- rejection, settled at 0. unused: an operation that never went out, settled at 0.
  classification text not null check (classification in ('evidence', 'deadline', 'noncharge', 'unused')),
  settled_microdollars bigint not null check (settled_microdollars between 0 and 1000000000000000),
  -- Always the reservation's whole amount: a settlement releases the reservation entirely and settles what happened.
  released_microdollars bigint not null check (released_microdollars between 1 and 1000000000000000),
  -- The evidence, for `evidence` only.
  input_tokens bigint check (input_tokens >= 0),
  output_tokens bigint check (output_tokens >= 0),
  returned_model text check (returned_model ~ '^[!-~]{1,200}$'),
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  constraint settlements_reservation_fkey foreign key (reservation_id, account_id) references usage.reservations (id, account_id) on delete restrict,
  constraint settlements_period_fkey foreign key (period_id, account_id) references usage.periods (id, account_id) on delete restrict,
  constraint settlements_reservation_key unique (reservation_id),
  constraint settlements_id_account_key unique (id, account_id),
  constraint settlements_evidence_shape check (
    case classification
      when 'evidence' then input_tokens is not null and output_tokens is not null and returned_model is not null
      else input_tokens is null and output_tokens is null and returned_model is null
    end
  ),
  constraint settlements_zero_shape check (classification not in ('noncharge', 'unused') or settled_microdollars = 0),
  constraint settlements_deadline_shape check (classification <> 'deadline' or settled_microdollars = released_microdollars)
);

comment on table usage.settlements is
  'The append-only settlement ledger (Story 2.6): one row for each reservation. It releases the reservation''s whole amount and settles the evidence, the reservation (deadline) or nothing (noncharge, unused). Over by settled - released. Update and truncate are refused; delete is left for the Epic 8 purge.';

create index settlements_period_idx on usage.settlements (period_id);

-- A settlement releases exactly its reservation's amount, and is made in the period of the reservation or a later one.
create function usage.check_settlement() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_reservation usage.reservations;
  v_reserved_seq integer;
  v_seq integer;
begin
  select * into v_reservation from usage.reservations r where r.id = new.reservation_id and r.account_id = new.account_id;
  if not found then
    raise exception 'usage.settlements: the reservation is the Account''s own' using errcode = '23514';
  end if;
  if new.released_microdollars <> v_reservation.reserved_microdollars then
    raise exception 'usage.settlements: a settlement releases the reservation''s whole amount' using errcode = '23514';
  end if;
  if new.classification = 'deadline' and new.settled_microdollars <> v_reservation.reserved_microdollars then
    raise exception 'usage.settlements: a deadline settles exactly the reserved amount' using errcode = '23514';
  end if;
  select p.seq into v_reserved_seq from usage.periods p where p.id = v_reservation.period_id;
  select p.seq into v_seq from usage.periods p where p.id = new.period_id;
  if v_seq < v_reserved_seq then
    raise exception 'usage.settlements: a settlement is not in a period before its reservation''s' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger settlements_check before insert on usage.settlements
  for each row execute function usage.check_settlement();
create trigger settlements_no_update before update on usage.settlements
  for each row execute function usage.refuse_record_change();
create trigger settlements_no_truncate before truncate on usage.settlements
  for each statement execute function usage.refuse_record_change();

-- The overrun incidents --------------------------------------------------------------------------------------------------------------------

create table usage.overrun_incidents (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references identity.accounts (id) on delete restrict,
  reservation_id uuid not null,
  settlement_id uuid not null,
  -- The provider whose usage evidence was above the reservation: until the incident is cleared no Account reserves for it.
  provider text not null check (provider ~ '^[a-z][a-z0-9._-]{0,79}$'),
  reserved_microdollars bigint not null check (reserved_microdollars between 1 and 1000000000000000),
  evidence_microdollars bigint not null check (evidence_microdollars between 2 and 1000000000000000),
  created_at timestamptz not null default clock_timestamp(),
  -- The one thing that ever changes: the clearing, by the freshly authenticated Administrator (Story 2.8).
  cleared_at timestamptz,
  cleared_by text check (cleared_by ~ '^user:[A-Za-z0-9_-]{1,64}$'),
  constraint overrun_incidents_reservation_fkey foreign key (reservation_id, account_id) references usage.reservations (id, account_id) on delete restrict,
  constraint overrun_incidents_settlement_fkey foreign key (settlement_id, account_id) references usage.settlements (id, account_id) on delete restrict,
  constraint overrun_incidents_reservation_key unique (reservation_id),
  constraint overrun_incidents_settlement_key unique (settlement_id),
  constraint overrun_incidents_over_shape check (evidence_microdollars > reserved_microdollars),
  constraint overrun_incidents_cleared_shape check ((cleared_at is null) = (cleared_by is null))
);

comment on table usage.overrun_incidents is
  'Usage evidence above a reservation (Story 2.6): written only by api.settle_cost. It blocks the provider for every Account until cleared; no function here clears one (Story 2.8). Only its one clearing ever changes a row. Delete is left for the Epic 8 purge.';

-- The question admission asks: is there an uncleared incident for this provider?
create index overrun_incidents_open_idx on usage.overrun_incidents (provider) where cleared_at is null;

-- An incident is the settlement that exceeded its reservation.
create function usage.check_incident() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_reservation usage.reservations;
  v_settlement usage.settlements;
begin
  select * into v_reservation from usage.reservations r where r.id = new.reservation_id and r.account_id = new.account_id;
  select * into v_settlement from usage.settlements s where s.id = new.settlement_id and s.account_id = new.account_id;
  if v_reservation.id is null or v_settlement.id is null or v_settlement.reservation_id <> v_reservation.id
     or v_settlement.classification <> 'evidence'
     or new.provider <> v_reservation.provider
     or new.reserved_microdollars <> v_reservation.reserved_microdollars
     or new.evidence_microdollars <> v_settlement.settled_microdollars then
    raise exception 'usage.overrun_incidents: an incident is the evidence settlement that exceeded its reservation' using errcode = '23514';
  end if;
  if new.cleared_at is not null then
    raise exception 'usage.overrun_incidents: an incident begins uncleared' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- An incident refuses everything but its one clearing: cleared_at and cleared_by set together, once, and no other column changes.
create function usage.guard_incident_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.cleared_at is not null then
    raise exception 'usage.overrun_incidents: a cleared incident is not changed' using errcode = '55000';
  end if;
  if new.cleared_at is null or new.cleared_by is null then
    raise exception 'usage.overrun_incidents: only the clearing changes an incident' using errcode = '55000';
  end if;
  if new.id is distinct from old.id or new.account_id is distinct from old.account_id or new.reservation_id is distinct from old.reservation_id
     or new.settlement_id is distinct from old.settlement_id or new.provider is distinct from old.provider
     or new.reserved_microdollars is distinct from old.reserved_microdollars or new.evidence_microdollars is distinct from old.evidence_microdollars
     or new.created_at is distinct from old.created_at then
    raise exception 'usage.overrun_incidents: only the clearing changes an incident' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger overrun_incidents_check before insert on usage.overrun_incidents
  for each row execute function usage.check_incident();
create trigger overrun_incidents_guard before update on usage.overrun_incidents
  for each row execute function usage.guard_incident_change();
create trigger overrun_incidents_no_truncate before truncate on usage.overrun_incidents
  for each statement execute function usage.refuse_record_change();

-- The receipts -----------------------------------------------------------------------------------------------------------------------------

create table usage.commands (
  account_id uuid not null references identity.accounts (id) on delete restrict,
  command_id uuid not null,
  kind text not null check (kind in ('reserve', 'settle')),
  -- SHA-256 (hex) of the kind and what the caller supplied (usage.cost_digest): what "the same command" means.
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  -- The reservation (reserve) or the settlement (settle) the command made or found.
  subject_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (account_id, command_id)
);

comment on table usage.commands is
  'The immutable receipts of the Usage commands (Story 2.6): one row for each (Account, command ID) that did its work or replayed. Never edited. Delete is left for the Epic 8 purge.';

create trigger commands_no_update before update on usage.commands
  for each row execute function usage.refuse_record_change();
create trigger commands_no_truncate before truncate on usage.commands
  for each statement execute function usage.refuse_record_change();

-- Closed by default ------------------------------------------------------------------------------------------------------------------------

alter table usage.rate_schedules enable row level security;
alter table usage.reservations enable row level security;
alter table usage.settlements enable row level security;
alter table usage.overrun_incidents enable row level security;
alter table usage.commands enable row level security;
-- No policy: only the owner and roles that bypass RLS can read a row, and the privileges below leave anon, authenticated and service_role no path to the tables.
revoke all on usage.rate_schedules from public, anon, authenticated, service_role;
revoke all on usage.reservations from public, anon, authenticated, service_role;
revoke all on usage.settlements from public, anon, authenticated, service_role;
revoke all on usage.overrun_incidents from public, anon, authenticated, service_role;
revoke all on usage.commands from public, anon, authenticated, service_role;

-- The calculator: the price, and the quote's judgement ------------------------------------------------------------------------------------

-- THE PRICE of one operation under a pinned schedule, rounded up ONCE. The sum of the three terms is taken over the common denominator of the three rates and
-- multiplied by the multiplier, all in integers; the ceiling of the quotient of two integers is an integer division, so nothing is rounded before the end. It
-- returns the billed units too. The microdollars are NOT bounded here: a caller classifies `overflow` (above 1e15) and `unpriced` (nothing).
create function usage.price(p_schedule_id uuid, p_input_tokens numeric, p_output_tokens numeric, p_requests integer)
returns table (input_units numeric, output_units numeric, microdollars numeric)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_schedule usage.rate_schedules;
  v_input numeric;
  v_output numeric;
  v_numerator numeric;
  v_denominator numeric;
begin
  select * into v_schedule from usage.rate_schedules s where s.id = p_schedule_id;
  if not found then
    raise exception 'usage.price: no such rate schedule' using errcode = '22023';
  end if;
  v_input := usage.billed_units(p_input_tokens, v_schedule.input_increment);
  v_output := usage.billed_units(p_output_tokens, v_schedule.output_increment);
  v_numerator :=
      v_input * v_schedule.input_rate_num * v_schedule.output_rate_den * v_schedule.request_rate_den
    + v_output * v_schedule.output_rate_num * v_schedule.input_rate_den * v_schedule.request_rate_den
    + p_requests::numeric * v_schedule.request_rate_num * v_schedule.input_rate_den * v_schedule.output_rate_den;
  v_denominator := v_schedule.input_rate_den::numeric * v_schedule.output_rate_den * v_schedule.request_rate_den;
  v_numerator := v_numerator * v_schedule.multiplier_num;
  v_denominator := v_denominator * v_schedule.multiplier_den;
  return query select v_input, v_output, div(v_numerator + v_denominator - 1, v_denominator);
end;
$$;

comment on function usage.price(uuid, numeric, numeric, integer) is
  'The price in microdollars of one operation under a rate schedule: billed units rounded up to the increments, the three terms over a common denominator times the multiplier, rounded up ONCE, all exact. Returns the billed units too. Callable by no API role.';

-- What a bounded request costs, or why no bound is available. The order of the reasons is the order of the checks.
--   unknown_rate (no such schedule), foreign_rate (its provider, model or API version differ from those given), foreign_currency (not USD), unsupported_option (any key
--   in the options: none is supported; `detail` names the first, in byte order), over_input_ceiling (the raised bound is above 200,000), over_output_ceiling,
--   over_request_ceiling, overflow (above 1e15) and unpriced (nothing).
-- With no reason, `bound`, `billed_input`, `billed_output` and `cost` are set.
create function usage.bound_cost(
  p_schedule_id uuid, p_provider text, p_model text, p_api_version text, p_request_bytes bigint, p_image_count integer, p_output_limit integer,
  p_request_count integer, p_options jsonb,
  out refusal text, out refusal_detail text, out bound bigint, out billed_input bigint, out billed_output bigint, out cost bigint
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_schedule usage.rate_schedules;
  v_bound numeric;
  v_priced record;
begin
  select * into v_schedule from usage.rate_schedules s where s.id = p_schedule_id;
  if not found then
    refusal := 'unknown_rate';
    return;
  end if;
  if v_schedule.provider <> p_provider or v_schedule.model <> p_model or v_schedule.api_version <> p_api_version then
    refusal := 'foreign_rate';
    return;
  end if;
  if v_schedule.currency <> 'USD' then
    refusal := 'foreign_currency';
    return;
  end if;
  if p_options <> '{}'::jsonb then
    refusal := 'unsupported_option';
    select left(k.key, 100) into refusal_detail from jsonb_object_keys(p_options) as k(key) order by k.key collate "C" limit 1;
    return;
  end if;
  v_bound := usage.input_bound(p_request_bytes, p_image_count);
  if v_bound > usage.input_ceiling() then
    refusal := 'over_input_ceiling';
    return;
  end if;
  if p_output_limit > usage.output_ceiling() then
    refusal := 'over_output_ceiling';
    return;
  end if;
  if p_request_count > usage.request_ceiling() then
    refusal := 'over_request_ceiling';
    return;
  end if;
  select * into v_priced from usage.price(p_schedule_id, v_bound, p_output_limit::numeric, p_request_count);
  if v_priced.microdollars > 1000000000000000 then
    refusal := 'overflow';
    return;
  end if;
  if v_priced.microdollars = 0 then
    refusal := 'unpriced';
    return;
  end if;
  bound := v_bound::bigint;
  billed_input := v_priced.input_units::bigint;
  billed_output := v_priced.output_units::bigint;
  cost := v_priced.microdollars::bigint;
end;
$$;

comment on function usage.bound_cost(uuid, text, text, text, bigint, integer, integer, integer, jsonb) is
  'The quote''s judgement: the input bound, billed units and microdollars of a bounded request under a pinned schedule, or the reason none is available. Shared by quote and reserve. Callable by no API role.';

-- The Job's exposure and the figures --------------------------------------------------------------------------------------------------------

-- What the Job holds against its $5 cap, over every reservation of every attempt: the settled amount where settled, the reserved amount where not (an ambiguous
-- or dispatched charge holds its reservation, and evidence above a reservation counts at the evidence).
create function usage.job_exposure(p_job_id uuid) returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(coalesce(s.settled_microdollars, r.reserved_microdollars)), 0)::bigint
    from usage.reservations r
    left join usage.settlements s on s.reservation_id = r.id
   where r.job_id = p_job_id
$$;

comment on function usage.job_exposure(uuid) is
  'The exposure of a Job across all its attempts: the settled amount of each reservation that is settled and the reserved amount of each that is not. Callable by no API role.';

-- The settled and reserved figures OF the period (what the carried amounts are added to), as SIGNED DELTAS from the ledgers: reserved = the reservations made in the
-- period less what the settlements made in the period released (negative when it releases a reservation of an earlier period, which the successor's carry still
-- counts), settled = what the settlements made in the period settled. Replaces the stand-in of Story 2.4 (same signature).
create or replace function usage.period_figures(p_period_id uuid)
returns table (settled_microdollars bigint, reserved_microdollars bigint)
language sql
stable
set search_path = ''
as $$
  select coalesce((select sum(s.settled_microdollars) from usage.settlements s where s.period_id = p_period_id), 0)::bigint,
         (coalesce((select sum(r.reserved_microdollars) from usage.reservations r where r.period_id = p_period_id), 0)
          - coalesce((select sum(s.released_microdollars) from usage.settlements s where s.period_id = p_period_id), 0))::bigint
$$;

comment on function usage.period_figures(uuid) is
  'The settled and reserved figures of one period, the only way they are read: signed deltas from the reservation and settlement ledgers. Callable by no API role.';

-- Nothing reads the stand-in any longer.
drop table usage.fixture_figures;

-- Digests and receipts ------------------------------------------------------------------------------------------------------------------------

-- What a command asked for: SHA-256 (hex) over the length-prefixed kind and arguments, an absent argument a dash.
create function usage.cost_digest(p_kind text, p_arguments text[]) returns text
language sql
stable
set search_path = ''
as $$
  select encode(sha256(convert_to(
    projects.length_prefixed(p_kind)
    || coalesce((select string_agg(projects.length_prefixed(x.argument), '' order by x.position) from unnest(p_arguments) with ordinality as x(argument, position)), ''),
    'UTF8')), 'hex')
$$;

comment on function usage.cost_digest(text, text[]) is
  'SHA-256 (hex) over the length-prefixed kind and arguments of a Usage command. Callable by no API role.';

-- The receipt of a command that did its work or replayed. The only writer of usage.commands.
create function usage.record_command(p_account_id uuid, p_command_id uuid, p_kind text, p_digest text, p_subject_id uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into usage.commands (account_id, command_id, kind, digest, subject_id) values (p_account_id, p_command_id, p_kind, p_digest, p_subject_id);
end;
$$;

comment on function usage.record_command(uuid, uuid, text, text, uuid) is
  'Writes the receipt of a Usage command. The only writer of usage.commands. Callable by no API role.';

-- The command: quote ---------------------------------------------------------------------------------------------------------------------------

-- outcome: quoted | unavailable_bound | denied. quoted carries the input bound, the billed units and the microdollars; unavailable_bound carries the reason (and
-- the first option key for unsupported_option).
create type api.cost_quotation as (
  outcome text,
  reason text,
  detail text,
  input_bound bigint,
  input_units bigint,
  output_units bigint,
  microdollars bigint
);

create function api.quote_cost(
  p_account_id uuid, p_epoch bigint, p_rate_schedule_id uuid, p_provider text, p_model text, p_api_version text,
  p_request_bytes bigint, p_image_count integer, p_output_limit integer, p_request_count integer default 1, p_options jsonb default '{}'::jsonb
) returns api.cost_quotation
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.cost_quotation;
  v_quote record;
begin
  -- 1. The arguments.
  if p_account_id is null or p_epoch is null or p_epoch < 1 or p_rate_schedule_id is null
     or p_provider is null or p_provider !~ '^[a-z][a-z0-9._-]{0,79}$'
     or p_model is null or p_model !~ '^[a-z][a-z0-9._-]{0,79}$'
     or p_api_version is null or p_api_version !~ '^[!-~]{1,100}$'
     or p_request_bytes is null or p_request_bytes < 0
     or p_image_count is null or p_image_count < 0
     or p_output_limit is null or p_output_limit < 0
     or p_request_count is null or p_request_count < 1
     or p_options is null or jsonb_typeof(p_options) <> 'object' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  -- 2. The authority.
  begin
    perform identity.assert_operation_authority(p_account_id, p_epoch);
  exception when sqlstate 'N3010' then
    v_result.outcome := 'denied';
    return v_result;
  end;

  -- 3. The calculator. Read-only: no advisory lock, no write.
  select * into v_quote from usage.bound_cost(
    p_rate_schedule_id, p_provider, p_model, p_api_version, p_request_bytes, p_image_count, p_output_limit, p_request_count, p_options);
  if v_quote.refusal is not null then
    v_result.outcome := 'unavailable_bound';
    v_result.reason := v_quote.refusal;
    v_result.detail := v_quote.refusal_detail;
    return v_result;
  end if;
  v_result.outcome := 'quoted';
  v_result.input_bound := v_quote.bound;
  v_result.input_units := v_quote.billed_input;
  v_result.output_units := v_quote.billed_output;
  v_result.microdollars := v_quote.cost;
  return v_result;
end;
$$;

comment on function api.quote_cost(uuid, bigint, uuid, text, text, text, bigint, integer, integer, integer, jsonb) is
  'What a bounded request costs under a pinned rate schedule: the input bound, the billed units and the microdollars, rounded up once, or unavailable_bound with the reason (unknown_rate, foreign_rate, foreign_currency, unsupported_option, over_input_ceiling, over_output_ceiling, over_request_ceiling, overflow, unpriced). Read-only: takes no lock. quoted | unavailable_bound | denied.';

-- The command: reserve -------------------------------------------------------------------------------------------------------------------------

-- outcome: reserved | replayed | reused | already_reserved | denied | unavailable | not_reservable | unavailable_bound | provider_blocked | over_operation_cap |
-- over_job_cap | insufficient_allowance.
-- The reservation's fields are set for reserved, replayed and already_reserved. `state` is the operation's state for not_reservable. `reason` (and `detail`) say why a
-- bound is unavailable. The COST BLOCK of a money refusal (unavailable_bound, provider_blocked, over_operation_cap, over_job_cap, insufficient_allowance) is
-- requested (the reserved amount the request would need; null when no bound could be computed), the cap or limit that applies, what is used against it and
-- what is available under it: the operation cap for over_operation_cap, the Job cap for over_job_cap, the Account's period limit for the others.
create type api.cost_reservation as (
  outcome text,
  reservation_id uuid,
  operation_id uuid,
  job_id uuid,
  period_id uuid,
  rate_schedule_id uuid,
  input_bound bigint,
  reserved_microdollars bigint,
  state text,
  reason text,
  detail text,
  requested_microdollars bigint,
  limit_microdollars bigint,
  used_microdollars bigint,
  available_microdollars bigint
);

create function api.reserve_cost(
  p_account_id uuid, p_epoch bigint, p_command_id uuid, p_operation_id uuid, p_rate_schedule_id uuid, p_provider text, p_model text, p_api_version text,
  p_request_bytes bigint, p_image_count integer, p_output_limit integer, p_options jsonb default '{}'::jsonb
) returns api.cost_reservation
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.cost_reservation;
  v_job_id uuid;
  v_project_id uuid;
  v_digest text;
  v_command usage.commands;
  v_operation jobs.operations;
  v_reservation usage.reservations;
  v_period usage.periods;
  v_quote record;
  v_settled bigint;
  v_reserved bigint;
  v_used bigint;
  v_available bigint;
  v_exposure bigint;
begin
  -- 1. The arguments.
  if p_account_id is null or p_epoch is null or p_epoch < 1 or p_command_id is null or p_operation_id is null or p_rate_schedule_id is null
     or p_provider is null or p_provider !~ '^[a-z][a-z0-9._-]{0,79}$'
     or p_model is null or p_model !~ '^[a-z][a-z0-9._-]{0,79}$'
     or p_api_version is null or p_api_version !~ '^[!-~]{1,100}$'
     or p_request_bytes is null or p_request_bytes < 0
     or p_image_count is null or p_image_count < 0
     or p_output_limit is null or p_output_limit < 0
     or p_options is null or jsonb_typeof(p_options) <> 'object' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  -- 2. The authority (this takes the Account's row FOR SHARE until the end of the transaction).
  begin
    perform identity.assert_operation_authority(p_account_id, p_epoch);
  exception when sqlstate 'N3010' then
    v_result.outcome := 'denied';
    return v_result;
  end;

  -- 3. One command ID at a time for an Account.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:usage-command:' || p_account_id::text || ':' || p_command_id::text, 0));

  -- 4. The operation belongs to the Account and its Project is held FOR SHARE, live and without a tombstone: ONE answer for a foreign, a deleted, an unknown and a
  -- tombstoned one. api.record_tombstone takes the same row FOR UPDATE, so a reservation can never land after a tombstone. The operation's own row is held FOR SHARE
  -- as well, so a move of the operation (a dispatch, an abandonment) and this reservation are serial.
  select a.job_id, j.project_id into v_job_id, v_project_id
    from jobs.operations o
    join jobs.steps s on s.id = o.step_id and s.account_id = o.account_id
    join jobs.attempts a on a.id = s.attempt_id and a.account_id = s.account_id
    join jobs.jobs j on j.id = a.job_id and j.account_id = a.account_id
   where o.id = p_operation_id and o.account_id = p_account_id;
  if not found or not jobs.hold_project(p_account_id, v_project_id) then
    v_result.outcome := 'unavailable';
    return v_result;
  end if;
  select * into v_operation from jobs.operations o where o.id = p_operation_id for share;

  -- 5. One reserver at a time for an Account (the lock Story 2.4 reserved), and the month turns when work is first asked for.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:usage:' || p_account_id::text, 0));
  v_period := usage.ensure_period(p_account_id);

  -- 6. The receipt: what this command ID made.
  v_digest := usage.cost_digest('reserve_cost', array[
    p_operation_id::text, p_rate_schedule_id::text, p_provider, p_model, p_api_version, p_request_bytes::text, p_image_count::text, p_output_limit::text, p_options::text]);
  select * into v_command from usage.commands c where c.account_id = p_account_id and c.command_id = p_command_id;
  if found then
    if v_command.kind <> 'reserve' or v_command.digest <> v_digest then
      v_result.outcome := 'reused';
      return v_result;
    end if;
    select * into v_reservation from usage.reservations r where r.id = v_command.subject_id;
    -- A receipt names the reservation it made or found. If that row is gone the ledger no longer agrees with its receipts, and that is not an answer to give.
    if not found then
      raise exception 'usage.commands: receipt subject missing' using errcode = '55000';
    end if;
    v_result.outcome := 'replayed';
    v_result.reservation_id := v_reservation.id;
    v_result.operation_id := v_reservation.operation_id;
    v_result.job_id := v_reservation.job_id;
    v_result.period_id := v_reservation.period_id;
    v_result.rate_schedule_id := v_reservation.rate_schedule_id;
    v_result.input_bound := v_reservation.input_bound;
    v_result.reserved_microdollars := v_reservation.reserved_microdollars;
    return v_result;
  end if;

  -- 7. The operation already holds a reservation, made under another command ID: the same payload replays (and is recorded under this ID too), another is refused.
  select * into v_reservation from usage.reservations r where r.operation_id = p_operation_id;
  if found then
    v_result.reservation_id := v_reservation.id;
    v_result.operation_id := v_reservation.operation_id;
    v_result.job_id := v_reservation.job_id;
    v_result.period_id := v_reservation.period_id;
    v_result.rate_schedule_id := v_reservation.rate_schedule_id;
    v_result.input_bound := v_reservation.input_bound;
    v_result.reserved_microdollars := v_reservation.reserved_microdollars;
    if v_reservation.digest = v_digest then
      perform usage.record_command(p_account_id, p_command_id, 'reserve', v_digest, v_reservation.id);
      v_result.outcome := 'replayed';
    else
      v_result.outcome := 'already_reserved';
    end if;
    return v_result;
  end if;

  -- 8. Only a planned operation is reserved for.
  if v_operation.state <> 'planned' then
    v_result.outcome := 'not_reservable';
    v_result.state := v_operation.state;
    return v_result;
  end if;

  -- What the Account has used in this period and what is left of it: the block every money refusal below carries (the caps replace the limit, used and available).
  select f.settled_microdollars, f.reserved_microdollars into v_settled, v_reserved from usage.period_figures(v_period.id) f;
  v_used := v_period.carried_settled_microdollars + v_settled + v_period.carried_reserved_microdollars + v_reserved;
  v_available := greatest(v_period.limit_microdollars - v_used, 0);
  v_result.limit_microdollars := v_period.limit_microdollars;
  v_result.used_microdollars := v_used;
  v_result.available_microdollars := v_available;

  -- 9. The calculator.
  select * into v_quote from usage.bound_cost(
    p_rate_schedule_id, p_provider, p_model, p_api_version, p_request_bytes, p_image_count, p_output_limit, 1, p_options);
  if v_quote.refusal is not null then
    v_result.outcome := 'unavailable_bound';
    v_result.reason := v_quote.refusal;
    v_result.detail := v_quote.refusal_detail;
    return v_result;
  end if;
  v_result.requested_microdollars := v_quote.cost;
  v_result.input_bound := v_quote.bound;

  -- 10. A provider with an uncleared overrun incident admits no one, whichever Account the incident was of.
  if exists (select 1 from usage.overrun_incidents i where i.provider = p_provider and i.cleared_at is null) then
    v_result.outcome := 'provider_blocked';
    return v_result;
  end if;

  -- 11. The operation cap.
  if v_quote.cost > usage.operation_cap() then
    v_result.outcome := 'over_operation_cap';
    v_result.limit_microdollars := usage.operation_cap();
    v_result.used_microdollars := 0;
    v_result.available_microdollars := usage.operation_cap();
    return v_result;
  end if;

  -- 12. The Job cap, over every attempt of the Job.
  v_exposure := usage.job_exposure(v_job_id);
  if v_exposure + v_quote.cost > usage.job_cap() then
    v_result.outcome := 'over_job_cap';
    v_result.limit_microdollars := usage.job_cap();
    v_result.used_microdollars := v_exposure;
    v_result.available_microdollars := greatest(usage.job_cap() - v_exposure, 0);
    return v_result;
  end if;

  -- 13. The Account's allowance.
  if v_quote.cost > v_available then
    v_result.outcome := 'insufficient_allowance';
    return v_result;
  end if;

  -- 14. One reservation, in the current period, and its receipt.
  insert into usage.reservations (
    account_id, period_id, job_id, operation_id, rate_schedule_id, provider, requested_model, api_version,
    request_bytes, image_count, output_limit, input_bound, reserved_microdollars, digest
  ) values (
    p_account_id, v_period.id, v_job_id, p_operation_id, p_rate_schedule_id, p_provider, p_model, p_api_version,
    p_request_bytes, p_image_count, p_output_limit, v_quote.bound, v_quote.cost, v_digest
  ) returning * into v_reservation;
  perform usage.record_command(p_account_id, p_command_id, 'reserve', v_digest, v_reservation.id);

  v_result.outcome := 'reserved';
  v_result.reservation_id := v_reservation.id;
  v_result.operation_id := v_reservation.operation_id;
  v_result.job_id := v_reservation.job_id;
  v_result.period_id := v_reservation.period_id;
  v_result.rate_schedule_id := v_reservation.rate_schedule_id;
  v_result.input_bound := v_reservation.input_bound;
  v_result.reserved_microdollars := v_reservation.reserved_microdollars;
  v_result.requested_microdollars := null;
  v_result.limit_microdollars := null;
  v_result.used_microdollars := null;
  v_result.available_microdollars := null;
  return v_result;
end;
$$;

comment on function api.reserve_cost(uuid, bigint, uuid, uuid, uuid, text, text, text, bigint, integer, integer, jsonb) is
  'Reserves the enforceable maximum cost of ONE external operation against the Account''s allowance, the Job''s $5 cap and the $1 operation cap in one transaction. Account, epoch, command ID, typed payload. reserved | replayed | reused | already_reserved | denied | unavailable | not_reservable (carries the state) | unavailable_bound (reason) | provider_blocked | over_operation_cap | over_job_cap | insufficient_allowance (the last five carry the cost block). A refusal writes no reservation, settlement, incident or receipt; the month may turn first.';

-- The command: settle -------------------------------------------------------------------------------------------------------------------------

-- outcome: settled | replayed | reused | already_settled | not_reserved | not_settleable | not_due | invalid_evidence | unavailable.
-- The settlement's fields are set for settled, replayed and already_settled. `over_microdollars` is settled - released when the evidence exceeded the reservation
-- (and an incident was recorded), else 0. `state` is the operation's state for not_settleable, `due_at` the time a deadline settlement becomes due for not_due,
-- and `reason` says why evidence is invalid.
create type api.cost_settlement as (
  outcome text,
  settlement_id uuid,
  reservation_id uuid,
  operation_id uuid,
  period_id uuid,
  classification text,
  settled_microdollars bigint,
  released_microdollars bigint,
  over_microdollars bigint,
  incident_id uuid,
  state text,
  due_at timestamptz,
  reason text
);

create function api.settle_cost(
  p_account_id uuid, p_command_id uuid, p_operation_id uuid, p_classification text,
  p_input_tokens bigint default null, p_output_tokens bigint default null, p_returned_model text default null
) returns api.cost_settlement
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.cost_settlement;
  v_digest text;
  v_command usage.commands;
  v_operation jobs.operations;
  v_reservation usage.reservations;
  v_settlement usage.settlements;
  v_period usage.periods;
  v_priced record;
  v_settled bigint;
  v_due timestamptz;
  v_incident_id uuid;
begin
  -- 1. The arguments: the evidence fields come with `evidence` and with nothing else.
  if p_account_id is null or p_command_id is null or p_operation_id is null
     or p_classification is null or p_classification not in ('evidence', 'deadline', 'noncharge', 'unused')
     or (p_classification = 'evidence' and (p_input_tokens is null or p_output_tokens is null or p_returned_model is null))
     or (p_classification <> 'evidence' and (p_input_tokens is not null or p_output_tokens is not null or p_returned_model is not null))
     or (p_input_tokens is not null and p_input_tokens < 0)
     or (p_output_tokens is not null and p_output_tokens < 0)
     or (p_returned_model is not null and p_returned_model !~ '^[!-~]{1,200}$') then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  -- 2. One command ID at a time for an Account. There is NO check of the Account's epoch or status, and none of its Project: settling records what already
  -- happened or releases what never went out, and refusing it for a disabled, stale or tombstoned Account would strand the money.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:usage-command:' || p_account_id::text || ':' || p_command_id::text, 0));

  -- 3. The operation belongs to the Account (`unavailable` for a foreign or unknown one). Its row is held FOR SHARE, so its state is the one the settlement is judged by.
  select * into v_operation from jobs.operations o where o.id = p_operation_id and o.account_id = p_account_id for share;
  if not found then
    v_result.outcome := 'unavailable';
    return v_result;
  end if;

  -- 4. One settler at a time for an Account, and the month turns when work is first asked for.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:usage:' || p_account_id::text, 0));
  v_period := usage.ensure_period(p_account_id);

  -- 5. The receipt.
  v_digest := usage.cost_digest('settle_cost', array[p_operation_id::text, p_classification, p_input_tokens::text, p_output_tokens::text, p_returned_model]);
  select * into v_command from usage.commands c where c.account_id = p_account_id and c.command_id = p_command_id;
  if found then
    if v_command.kind <> 'settle' or v_command.digest <> v_digest then
      v_result.outcome := 'reused';
      return v_result;
    end if;
    select * into v_settlement from usage.settlements s where s.id = v_command.subject_id;
    -- A receipt names the settlement it made or found. If that row is gone the ledger no longer agrees with its receipts, and that is not an answer to give.
    if not found then
      raise exception 'usage.commands: receipt subject missing' using errcode = '55000';
    end if;
    v_result.outcome := 'replayed';
    v_result.settlement_id := v_settlement.id;
    v_result.reservation_id := v_settlement.reservation_id;
    v_result.operation_id := p_operation_id;
    v_result.period_id := v_settlement.period_id;
    v_result.classification := v_settlement.classification;
    v_result.settled_microdollars := v_settlement.settled_microdollars;
    v_result.released_microdollars := v_settlement.released_microdollars;
    v_result.over_microdollars := greatest(v_settlement.settled_microdollars - v_settlement.released_microdollars, 0);
    select i.id into v_result.incident_id from usage.overrun_incidents i where i.settlement_id = v_settlement.id;
    return v_result;
  end if;

  -- 6. The operation holds no reservation.
  select * into v_reservation from usage.reservations r where r.operation_id = p_operation_id;
  if not found then
    v_result.outcome := 'not_reserved';
    return v_result;
  end if;

  -- 7. Already settled: the same classification and evidence replays (recorded under this ID too), another is refused. Settling is once.
  select * into v_settlement from usage.settlements s where s.reservation_id = v_reservation.id;
  if found then
    v_result.settlement_id := v_settlement.id;
    v_result.reservation_id := v_settlement.reservation_id;
    v_result.operation_id := p_operation_id;
    v_result.period_id := v_settlement.period_id;
    v_result.classification := v_settlement.classification;
    v_result.settled_microdollars := v_settlement.settled_microdollars;
    v_result.released_microdollars := v_settlement.released_microdollars;
    v_result.over_microdollars := greatest(v_settlement.settled_microdollars - v_settlement.released_microdollars, 0);
    select i.id into v_result.incident_id from usage.overrun_incidents i where i.settlement_id = v_settlement.id;
    if v_settlement.digest = v_digest then
      perform usage.record_command(p_account_id, p_command_id, 'settle', v_digest, v_settlement.id);
      v_result.outcome := 'replayed';
    else
      v_result.outcome := 'already_settled';
    end if;
    return v_result;
  end if;

  -- 8. The operation's state has to fit the class.
  if not (case p_classification
            when 'evidence' then v_operation.state in ('completed', 'ambiguous', 'settled')
            when 'deadline' then v_operation.state in ('ambiguous', 'settled')
            when 'noncharge' then v_operation.state = 'noncharge'
            else v_operation.state = 'abandoned'
          end) then
    v_result.outcome := 'not_settleable';
    v_result.state := v_operation.state;
    return v_result;
  end if;

  -- 9. A deadline settlement is due 24 hours after the outcome was recorded.
  if p_classification = 'deadline' then
    v_due := v_operation.outcome_at + usage.ambiguity_deadline();
    if clock_timestamp() < v_due then
      v_result.outcome := 'not_due';
      v_result.due_at := v_due;
      return v_result;
    end if;
  end if;

  -- 10. What is settled: the evidence priced by the calculator at the pinned schedule, the reservation itself, or nothing.
  if p_classification = 'evidence' then
    select * into v_priced from usage.price(v_reservation.rate_schedule_id, p_input_tokens::numeric, p_output_tokens::numeric, 1);
    if v_priced.microdollars > 1000000000000000 then
      v_result.outcome := 'invalid_evidence';
      v_result.reason := 'overflow';
      return v_result;
    end if;
    v_settled := v_priced.microdollars::bigint;
  elsif p_classification = 'deadline' then
    v_settled := v_reservation.reserved_microdollars;
  else
    v_settled := 0;
  end if;

  -- 11. One settlement in the current period, and when the evidence exceeds the reservation also one incident, in the same transaction.
  insert into usage.settlements (
    account_id, reservation_id, period_id, classification, settled_microdollars, released_microdollars, input_tokens, output_tokens, returned_model, digest
  ) values (
    p_account_id, v_reservation.id, v_period.id, p_classification, v_settled, v_reservation.reserved_microdollars, p_input_tokens, p_output_tokens, p_returned_model, v_digest
  ) returning * into v_settlement;
  if v_settled > v_reservation.reserved_microdollars then
    insert into usage.overrun_incidents (account_id, reservation_id, settlement_id, provider, reserved_microdollars, evidence_microdollars)
      values (p_account_id, v_reservation.id, v_settlement.id, v_reservation.provider, v_reservation.reserved_microdollars, v_settled)
      returning id into v_incident_id;
  end if;
  perform usage.record_command(p_account_id, p_command_id, 'settle', v_digest, v_settlement.id);

  v_result.outcome := 'settled';
  v_result.settlement_id := v_settlement.id;
  v_result.reservation_id := v_settlement.reservation_id;
  v_result.operation_id := p_operation_id;
  v_result.period_id := v_settlement.period_id;
  v_result.classification := v_settlement.classification;
  v_result.settled_microdollars := v_settlement.settled_microdollars;
  v_result.released_microdollars := v_settlement.released_microdollars;
  v_result.over_microdollars := greatest(v_settlement.settled_microdollars - v_settlement.released_microdollars, 0);
  v_result.incident_id := v_incident_id;
  return v_result;
end;
$$;

comment on function api.settle_cost(uuid, uuid, uuid, text, bigint, bigint, text) is
  'Settles the reservation of an operation: evidence (priced by the calculator at the pinned schedule), deadline (an ambiguous charge past 24 hours, at the reservation), noncharge or unused (at 0). Releases the whole reservation; evidence above it settles at the evidence and records an overrun incident. Account, command ID, typed payload; NO epoch, status or Project check, so a disable or a tombstone never strands the money. settled | replayed | reused | already_settled | not_reserved | not_settleable (carries the state) | not_due (carries the due time) | invalid_evidence | unavailable.';

-- The preflight -----------------------------------------------------------------------------------------------------------------------------------

-- Everything api.preflight read before (20261023120000_job_records.sql) but the probe of the fixture table, which is gone, plus what this story depends on: the five
-- tables of the Usage ledgers, the three new `api` functions (fifty in all, each executable by the service role) and the internal calculator and constant functions.
-- It checks the catalog and executes none of them, reads at most one row of each table and writes nothing. The bucket check stays last.
create or replace function api.preflight()
returns api.preflight_result
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result api.preflight_result;
  v_missing text;
begin
  perform g.session_id, g.csrf_hash, g.csrf_issued_at from identity.session_grants g limit 1;
  perform a.id, a.status, a.authorization_epoch, a.status_handle from identity.accounts a limit 1;
  perform p.account_id, p.locale, p.theme, p.detail, p.guidance, p.created_at, p.updated_at from identity.account_preferences p limit 1;
  perform 1 from identity.step_up_nonces limit 1;
  perform m.session_id, m.nonce_id, m.source from identity.fresh_authentications m limit 1;
  perform t.id, t.account_id, t.token_hash, t.issued_at, t.expires_at, t.used_at, t.voided_at from identity.recovery_tokens t limit 1;
  perform j.id, j.workspace_id, j.account_id, j.title, j.stage, j.current_version, j.revision, j.status_handle, j.created_at, j.updated_at, j.deleted_at from projects.projects j limit 1;
  perform c.account_id, c.command_id, c.project_id, c.command, c.payload_hash, c.expected_revision, c.title, c.revision, c.created_at from projects.project_commands c limit 1;
  perform q.id, q.project_id, q.account_id, q.seq, q.command_id, q.mode, q.subject_id, q.scope, q.outcome, q.description, q.personalization_wording, q.personalization_text, q.personalization_style, q.personalization_applied, q.personalization_reason, q.digest, q.confirmed_at, q.created_at, q.obstruction_confirmed_at, q.incomplete_acknowledged_at, q.incomplete_acknowledged_digest from projects.request_revisions q limit 1;
  perform y.revision_id, y.project_id, y.account_id, y.position, y.upload_id, y.sha256, y.length, y.content_type, y.view_label, y.short_edge_px, y.blur_variance, y.clipped_fraction, y.retained_root, y.retained_sha256, y.retained_length from projects.request_images y limit 1;
  perform s.kind, s.target_id, s.status_handle, s.revision, s.recorded_at from lifecycle.tombstones s limit 1;
  perform o.seq, o.id, o.event, o.created_at, o.relayed_at from lifecycle.ledger_outbox o limit 1;
  perform r.id, r.holder, r.lease_expires_at from lifecycle.ledger_relay r limit 1;
  perform q.scope, q.key_hash, q.window_id, q.requests, q.expires_at from lifecycle.status_requests q limit 1;
  perform b.id, b.task, b.schedule_id, b.message_id, b.attempt, b.started_at, b.finished_at, b.outcome, b.result from lifecycle.job_receipts b limit 1;
  perform l.id, l.account_id, l.kid, l.kind, l.length, l.sha256, l.content_type, l.received_length, l.state, l.created_at, l.expires_at from artifacts.staging_leases l limit 1;
  perform d.jti, d.typ, d.issuer, d.kid, d.account_id, d.session_id, d.direction, d.target_kind, d.target_id, d.expires_at, d.redeemed_at from artifacts.ticket_redemptions d limit 1;
  perform h.hash, h.jti, h.session_id, h.account_id, h.epoch, h.direction, h.target_kind, h.target_id, h.kid, h.created_at, h.expires_at, h.ended_at from artifacts.transfer_handles h limit 1;
  perform f.root, f.id, f.account_id, f.upload_id, f.kind, f.digest, f.length, f.serialization, f.activity, f.body, f.created_at from artifacts.manifests f limit 1;
  perform x.name, x.registered_at from artifacts.attachment_transforms x limit 1;
  perform v.issuer, v.kid, v.reason, v.revoked_at from artifacts.service_key_revocations v limit 1;
  perform w.session_id, w.account_id, w.epoch, w.state from artifacts.session_authority w limit 1;
  perform n.environment, n.instance_id from artifacts.instance n limit 1;
  perform e2.account_id, e2.upload_id, e2.root, e2.digest, e2.length, e2.content_type from artifacts.retained_pictures e2 limit 1;
  perform k.id, k.condition, k.subject, k.first_at, k.latest_at, k.resolved_at, k.detail from lifecycle.alarms k limit 1;
  perform e.id, e.alarm_id, e.at, e.outcome from lifecycle.alarm_notices e limit 1;
  perform z.id, z.jti, z.kid, z.received_at from lifecycle.heartbeats z limit 1;
  perform u.id, u.account_id, u.seq, u.month_start, u.limit_microdollars, u.carried_settled_microdollars, u.carried_reserved_microdollars, u.cause, u.previous_limit_microdollars, u.actor, u.command_id, u.digest, u.created_at from usage.periods u limit 1;
  perform jb.id, jb.account_id, jb.project_id, jb.kind, jb.created_at from jobs.jobs jb limit 1;
  perform at.id, at.account_id, at.job_id, at.number, at.previous_attempt_id, at.input_digest, at.state, at.stage, at.reason, at.created_at, at.started_at, at.ended_at from jobs.attempts at limit 1;
  perform sp.id, sp.account_id, sp.attempt_id, sp.step_key, sp.created_at from jobs.steps sp limit 1;
  perform op.id, op.account_id, op.step_id, op.ordinal, op.state, op.request_id, op.created_at, op.dispatched_at, op.outcome_at from jobs.operations op limit 1;
  perform cm.account_id, cm.command_id, cm.kind, cm.digest, cm.subject_id, cm.created_at from jobs.commands cm limit 1;
  perform rs.id, rs.provider, rs.model, rs.version, rs.api_version, rs.currency, rs.input_rate_num, rs.input_rate_den, rs.output_rate_num, rs.output_rate_den, rs.request_rate_num, rs.request_rate_den, rs.input_increment, rs.output_increment, rs.multiplier_num, rs.multiplier_den, rs.created_at from usage.rate_schedules rs limit 1;
  perform rv.id, rv.account_id, rv.period_id, rv.job_id, rv.operation_id, rv.rate_schedule_id, rv.provider, rv.requested_model, rv.api_version, rv.request_bytes, rv.image_count, rv.output_limit, rv.input_bound, rv.reserved_microdollars, rv.digest, rv.created_at from usage.reservations rv limit 1;
  perform st.id, st.account_id, st.reservation_id, st.period_id, st.classification, st.settled_microdollars, st.released_microdollars, st.input_tokens, st.output_tokens, st.returned_model, st.digest, st.created_at from usage.settlements st limit 1;
  perform oi.id, oi.account_id, oi.reservation_id, oi.settlement_id, oi.provider, oi.reserved_microdollars, oi.evidence_microdollars, oi.created_at, oi.cleared_at, oi.cleared_by from usage.overrun_incidents oi limit 1;
  perform uc.account_id, uc.command_id, uc.kind, uc.digest, uc.subject_id, uc.created_at from usage.commands uc limit 1;
  perform 1 from auth.sessions limit 1;
  perform 1 from auth.identities limit 1;
  perform 1 from auth.mfa_amr_claims limit 1;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.list_accounts()',
      'api.disable_account(text,uuid)',
      'api.enable_account(text,uuid)',
      'api.guard_operation(uuid,bigint)',
      'api.record_account_refusal(uuid,text,uuid)',
      'identity.assert_operation_authority(uuid,bigint)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 1.5 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.issue_recovery(text,text)',
      'api.void_recovery(text,boolean)',
      'api.check_recovery(text,text)',
      'api.redeem_recovery(text,text,uuid,uuid)',
      'identity.recovery_administrator(text)',
      'identity.record_recovery_refusal(text,text,text)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 1.6 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.list_projects(uuid,bigint,integer)',
      'api.get_project(uuid,bigint,uuid)',
      'api.rename_project(uuid,bigint,uuid,uuid,bigint,text)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 1.7 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.record_tombstone(text,uuid)',
      'api.guard_target(uuid,bigint,text,uuid)',
      'api.claim_ledger_events(uuid,integer,integer)',
      'api.finish_ledger_events(uuid,uuid[],boolean)',
      'api.ledger_pending()',
      'api.lookup_status(text,text)',
      'lifecycle.assert_not_tombstoned(text,uuid)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 1.8 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.claim_job_run(text,text,text,integer)',
      'api.finish_job_run(uuid,text,json)',
      'api.last_job_run(text)',
      'api.purge_dormant_identities(integer)',
      'lifecycle.job_result_ok(json)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 1.9 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.revoke_service_key(text,text,text)',
      'api.list_expired_staging(integer)',
      'artifacts.publish_attachment(uuid,bigint,uuid,text,text,text)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 1.12 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.raise_alarm(text,text,json)',
      'api.resolve_alarm(text,text)',
      'api.list_alarms(boolean,integer)',
      'api.alarms_due_mail(integer)',
      'api.record_alarm_notice(uuid,text)',
      'api.alarm_observations()',
      'api.record_heartbeat(text,text)',
      'lifecycle.alarm_detail_ok(json)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 1.13 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.create_project_request(uuid,bigint,uuid,text,text,text,text,text,text,text,text,text,boolean,text)',
      'api.read_project_request(uuid,bigint,uuid)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 2.1 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.record_picture_set(uuid,bigint,uuid,uuid,text,uuid[])',
      'api.release_staged_pictures(uuid,bigint,uuid[])',
      'projects.picture_set_digest(uuid,uuid,uuid[])'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 2.2 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.record_picture_review(uuid,bigint,uuid,uuid,integer,text,text,text,jsonb,boolean,boolean)',
      'projects.picture_review_images_valid(jsonb)',
      'projects.picture_review_incomplete(jsonb)',
      'projects.picture_review_digest(uuid,text,text,uuid[],text[])',
      'projects.picture_review_command_digest(uuid,uuid,integer,text,text,text,jsonb,boolean,boolean)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 2.3 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.check_picture_retention(uuid,bigint,uuid,integer,uuid[])',
      'api.read_retained_pictures(uuid,bigint,uuid)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 2.12 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.set_usage_limit(text,uuid,bigint,uuid,uuid,text,bigint,integer)',
      'api.list_usage(uuid,bigint)',
      'api.record_usage_refusal(uuid,text,uuid)',
      'usage.ensure_period(uuid)',
      'usage.period_figures(uuid)',
      'usage.available_microdollars(uuid)',
      'usage.default_limit(text)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 2.4 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.accept_job(uuid,bigint,uuid,uuid,text,text)',
      'api.begin_step(uuid,bigint,uuid,uuid,text,integer)',
      'api.advance_operation(uuid,bigint,uuid,uuid,text,text)',
      'api.move_attempt(uuid,bigint,uuid,uuid,text,text)',
      'api.request_retry(uuid,bigint,uuid,uuid,integer,text)',
      'api.read_job(uuid,bigint,uuid)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 2.11 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.quote_cost(uuid,bigint,uuid,text,text,text,bigint,integer,integer,integer,jsonb)',
      'api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb)',
      'api.settle_cost(uuid,uuid,uuid,text,bigint,bigint,text)',
      'usage.input_bound(bigint,integer)',
      'usage.price(uuid,numeric,numeric,integer)',
      'usage.job_exposure(uuid)',
      'usage.overhead_tokens()',
      'usage.image_tokens()',
      'usage.margin_percent()',
      'usage.input_ceiling()',
      'usage.output_ceiling()',
      'usage.request_ceiling()',
      'usage.operation_cap()',
      'usage.job_cap()',
      'usage.ambiguity_deadline()'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 2.6 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.list_accounts()',
      'api.disable_account(text,uuid)',
      'api.enable_account(text,uuid)',
      'api.guard_operation(uuid,bigint)',
      'api.record_account_refusal(uuid,text,uuid)',
      'api.issue_recovery(text,text)',
      'api.void_recovery(text,boolean)',
      'api.check_recovery(text,text)',
      'api.redeem_recovery(text,text,uuid,uuid)',
      'api.list_projects(uuid,bigint,integer)',
      'api.get_project(uuid,bigint,uuid)',
      'api.rename_project(uuid,bigint,uuid,uuid,bigint,text)',
      'api.record_tombstone(text,uuid)',
      'api.guard_target(uuid,bigint,text,uuid)',
      'api.claim_ledger_events(uuid,integer,integer)',
      'api.finish_ledger_events(uuid,uuid[],boolean)',
      'api.ledger_pending()',
      'api.lookup_status(text,text)',
      'api.claim_job_run(text,text,text,integer)',
      'api.finish_job_run(uuid,text,json)',
      'api.last_job_run(text)',
      'api.purge_dormant_identities(integer)',
      'api.revoke_service_key(text,text,text)',
      'api.list_expired_staging(integer)',
      'api.raise_alarm(text,text,json)',
      'api.resolve_alarm(text,text)',
      'api.list_alarms(boolean,integer)',
      'api.alarms_due_mail(integer)',
      'api.record_alarm_notice(uuid,text)',
      'api.alarm_observations()',
      'api.record_heartbeat(text,text)',
      'api.create_project_request(uuid,bigint,uuid,text,text,text,text,text,text,text,text,text,boolean,text)',
      'api.read_project_request(uuid,bigint,uuid)',
      'api.record_picture_set(uuid,bigint,uuid,uuid,text,uuid[])',
      'api.release_staged_pictures(uuid,bigint,uuid[])',
      'api.record_picture_review(uuid,bigint,uuid,uuid,integer,text,text,text,jsonb,boolean,boolean)',
      'api.check_picture_retention(uuid,bigint,uuid,integer,uuid[])',
      'api.read_retained_pictures(uuid,bigint,uuid)',
      'api.set_usage_limit(text,uuid,bigint,uuid,uuid,text,bigint,integer)',
      'api.list_usage(uuid,bigint)',
      'api.record_usage_refusal(uuid,text,uuid)',
      'api.accept_job(uuid,bigint,uuid,uuid,text,text)',
      'api.begin_step(uuid,bigint,uuid,uuid,text,integer)',
      'api.advance_operation(uuid,bigint,uuid,uuid,text,text)',
      'api.move_attempt(uuid,bigint,uuid,uuid,text,text)',
      'api.request_retry(uuid,bigint,uuid,uuid,integer,text)',
      'api.read_job(uuid,bigint,uuid)',
      'api.quote_cost(uuid,bigint,uuid,text,text,text,bigint,integer,integer,integer,jsonb)',
      'api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb)',
      'api.settle_cost(uuid,uuid,uuid,text,bigint,bigint,text)'
    ]) as f(signature)
   where not has_function_privilege('service_role', f.signature, 'execute');
  if v_missing is not null then
    raise exception 'api.preflight: the service role cannot execute %', v_missing using errcode = '42501';
  end if;

  if not has_table_privilege('auth.sessions', 'DELETE') then
    raise exception 'api.preflight: permission denied to end Auth sessions (delete on auth.sessions)' using errcode = '42501';
  end if;
  if not has_table_privilege('auth.users', 'DELETE') then
    raise exception 'api.preflight: permission denied to delete Auth identities (delete on auth.users)' using errcode = '42501';
  end if;

  -- Last, after every check of what the owner may read and delete: the bucket is read through row-level security (storage.buckets has it on), so a
  -- role that is not the migration's owner (the tests hand the function to one, to see each privilege check fire) sees no row here, and this check
  -- must not hide the ones before it.
  if not exists (select 1 from storage.buckets b where b.id = 'private-files' and b.public = false) then
    raise exception 'api.preflight: the private-files bucket is missing or public (the Story 1.12 migration creates it private)' using errcode = 'N3020';
  end if;

  v_result.ok := true;
  return v_result;
end;
$$;

comment on function api.preflight() is
  'Reads identity.session_grants (including its CSRF columns), identity.accounts (including its status handle), identity.account_preferences, identity.step_up_nonces, identity.fresh_authentications (including source), identity.recovery_tokens, projects.projects, projects.project_commands, projects.request_revisions (including the review columns), projects.request_images (including the labels and measurements and the retained pins), lifecycle.tombstones, lifecycle.ledger_outbox, lifecycle.ledger_relay, lifecycle.status_requests, lifecycle.job_receipts, the six artifacts tables and the artifacts.session_authority, artifacts.instance and artifacts.retained_pictures views, lifecycle.alarms, lifecycle.alarm_notices, lifecycle.heartbeats, usage.periods, jobs.jobs, jobs.attempts, jobs.steps, jobs.operations, jobs.commands, usage.rate_schedules, usage.reservations, usage.settlements, usage.overrun_incidents, usage.commands, auth.sessions, auth.identities and auth.mfa_amr_claims (one row each at most), checks that the Story 1.5, 1.6, 1.7, 1.8, 1.9, 1.12, 1.13, 2.1, 2.2, 2.3, 2.12, 2.4, 2.11 and 2.6 functions exist and are executable by the service role, that the private-files bucket exists and is private, and that the owner may delete from auth.sessions and auth.users, and answers ok. Read-only.';

-- Access ------------------------------------------------------------------------------------------------------------------------------------

revoke all on all tables in schema usage from public, anon, authenticated, service_role;
revoke all on all sequences in schema usage from public, anon, authenticated, service_role;
revoke all on all functions in schema usage from public, anon, authenticated, service_role;

-- Closed by default; only the service role is let in, by name. (create or replace keeps the grants api.preflight already had.)
grant execute on function api.quote_cost(uuid, bigint, uuid, text, text, text, bigint, integer, integer, integer, jsonb) to service_role;
grant execute on function api.reserve_cost(uuid, bigint, uuid, uuid, uuid, text, text, text, bigint, integer, integer, jsonb) to service_role;
grant execute on function api.settle_cost(uuid, uuid, uuid, text, bigint, bigint, text) to service_role;

-- New functions and types: have the Data API reload its schema cache now.
notify pgrst, 'reload schema';
