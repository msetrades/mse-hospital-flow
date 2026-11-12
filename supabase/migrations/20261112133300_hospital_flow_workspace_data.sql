create schema hospital;
revoke all on schema hospital from public, anon, authenticated;
grant usage on schema hospital to authenticated;

create table hospital.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, created_by)
);

create table hospital.census_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references hospital.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 160),
  observed_at timestamptz not null default now(),
  source_name text not null default '' check (length(source_name) <= 240),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create table hospital.unit_capacity (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references hospital.workspaces(id) on delete cascade,
  snapshot_id uuid not null,
  unit_name text not null check (length(btrim(unit_name)) between 1 and 120),
  physical_beds integer not null check (physical_beds > 0),
  occupied integer not null check (occupied >= 0 and occupied <= physical_beds),
  admissions_24h numeric(10,2) not null check (admissions_24h >= 0),
  discharges_24h numeric(10,2) not null check (discharges_24h >= 0),
  staffed_beds integer not null check (staffed_beds >= 0 and staffed_beds <= physical_beds),
  average_los_hours numeric(10,2) not null check (average_los_hours > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, snapshot_id)
    references hospital.census_snapshots(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  unique (workspace_id, id, snapshot_id),
  unique (snapshot_id, unit_name)
);

create table hospital.capacity_scenarios (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references hospital.workspaces(id) on delete cascade,
  snapshot_id uuid not null,
  name text not null check (length(btrim(name)) between 2 and 160),
  horizon_hours smallint not null check (horizon_hours between 6 and 72 and horizon_hours % 6 = 0),
  assumptions jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, snapshot_id)
    references hospital.census_snapshots(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  unique (workspace_id, id, snapshot_id)
);

create table hospital.scenario_units (
  workspace_id uuid not null,
  snapshot_id uuid not null,
  scenario_id uuid not null,
  unit_capacity_id uuid not null,
  projected_occupancy numeric(10,2) not null check (projected_occupancy >= 0),
  capacity_pressure numeric(10,5) not null check (capacity_pressure >= 0),
  spillover_beds numeric(10,2) not null check (spillover_beds >= 0),
  priority_rank integer not null check (priority_rank > 0),
  primary key (scenario_id, unit_capacity_id),
  foreign key (workspace_id, scenario_id, snapshot_id)
    references hospital.capacity_scenarios(workspace_id, id, snapshot_id) on delete cascade,
  foreign key (workspace_id, unit_capacity_id, snapshot_id)
    references hospital.unit_capacity(workspace_id, id, snapshot_id) on delete cascade
);

create index hospital_census_workspace_recent_idx on hospital.census_snapshots(workspace_id, observed_at desc);
create index hospital_capacity_snapshot_unit_idx on hospital.unit_capacity(snapshot_id, unit_name);
create index hospital_scenarios_workspace_recent_idx on hospital.capacity_scenarios(workspace_id, created_at desc);
create index hospital_scenario_units_rank_idx on hospital.scenario_units(scenario_id, priority_rank);

alter table hospital.workspaces enable row level security;
alter table hospital.census_snapshots enable row level security;
alter table hospital.unit_capacity enable row level security;
alter table hospital.capacity_scenarios enable row level security;
alter table hospital.scenario_units enable row level security;

create policy "owners read hospital workspaces" on hospital.workspaces
  for select to authenticated using (created_by = (select auth.uid()));
create policy "users create hospital workspaces" on hospital.workspaces
  for insert to authenticated with check (created_by = (select auth.uid()));
create policy "owners rename hospital workspaces" on hospital.workspaces
  for update to authenticated using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));
create policy "owners delete hospital workspaces" on hospital.workspaces
  for delete to authenticated using (created_by = (select auth.uid()));

create policy "workspace owners read censuses" on hospital.census_snapshots
  for select to authenticated using (exists (
    select 1 from hospital.workspaces w where w.id = workspace_id and w.created_by = (select auth.uid())
  ));
create policy "workspace owners create censuses" on hospital.census_snapshots
  for insert to authenticated with check (created_by = (select auth.uid()) and exists (
    select 1 from hospital.workspaces w where w.id = workspace_id and w.created_by = (select auth.uid())
  ));
create policy "workspace owners delete censuses" on hospital.census_snapshots
  for delete to authenticated using (exists (
    select 1 from hospital.workspaces w where w.id = workspace_id and w.created_by = (select auth.uid())
  ));

create policy "workspace owners read unit capacities" on hospital.unit_capacity
  for select to authenticated using (exists (
    select 1 from hospital.workspaces w where w.id = workspace_id and w.created_by = (select auth.uid())
  ));
create policy "workspace owners insert unit capacities" on hospital.unit_capacity
  for insert to authenticated with check (created_by = (select auth.uid()) and exists (
    select 1 from hospital.workspaces w where w.id = workspace_id and w.created_by = (select auth.uid())
  ));
create policy "workspace owners delete unit capacities" on hospital.unit_capacity
  for delete to authenticated using (exists (
    select 1 from hospital.workspaces w where w.id = workspace_id and w.created_by = (select auth.uid())
  ));

create policy "workspace owners read scenarios" on hospital.capacity_scenarios
  for select to authenticated using (exists (
    select 1 from hospital.workspaces w where w.id = workspace_id and w.created_by = (select auth.uid())
  ));
create policy "workspace owners create scenarios" on hospital.capacity_scenarios
  for insert to authenticated with check (created_by = (select auth.uid()) and exists (
    select 1 from hospital.workspaces w where w.id = workspace_id and w.created_by = (select auth.uid())
  ));
create policy "workspace owners delete scenarios" on hospital.capacity_scenarios
  for delete to authenticated using (exists (
    select 1 from hospital.workspaces w where w.id = workspace_id and w.created_by = (select auth.uid())
  ));

create policy "workspace owners read scenario unit results" on hospital.scenario_units
  for select to authenticated using (exists (
    select 1 from hospital.workspaces w where w.id = workspace_id and w.created_by = (select auth.uid())
  ));
create policy "workspace owners create scenario unit results" on hospital.scenario_units
  for insert to authenticated with check (exists (
    select 1 from hospital.workspaces w where w.id = workspace_id and w.created_by = (select auth.uid())
  ));
create policy "workspace owners delete scenario unit results" on hospital.scenario_units
  for delete to authenticated using (exists (
    select 1 from hospital.workspaces w where w.id = workspace_id and w.created_by = (select auth.uid())
  ));

revoke all on all tables in schema hospital from public, anon;
grant select, insert, update, delete on hospital.workspaces to authenticated;
grant select, insert, delete on hospital.census_snapshots to authenticated;
grant select, insert, delete on hospital.unit_capacity to authenticated;
grant select, insert, delete on hospital.capacity_scenarios to authenticated;
grant select, insert, delete on hospital.scenario_units to authenticated;
