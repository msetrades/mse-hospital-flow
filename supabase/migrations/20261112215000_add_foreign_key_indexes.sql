-- Index product foreign keys for joins and parent-row updates/deletes.
create index if not exists "mse_fk_capacity_scenarios_1" on "hospital"."capacity_scenarios" ("created_by");
create index if not exists "mse_fk_capacity_scenarios_2" on "hospital"."capacity_scenarios" ("workspace_id", "snapshot_id");
create index if not exists "mse_fk_census_snapshots_1" on "hospital"."census_snapshots" ("created_by");
create index if not exists "mse_fk_scenario_units_1" on "hospital"."scenario_units" ("workspace_id", "scenario_id", "snapshot_id");
create index if not exists "mse_fk_scenario_units_2" on "hospital"."scenario_units" ("workspace_id", "unit_capacity_id", "snapshot_id");
create index if not exists "mse_fk_unit_capacity_1" on "hospital"."unit_capacity" ("created_by");
create index if not exists "mse_fk_unit_capacity_2" on "hospital"."unit_capacity" ("workspace_id", "snapshot_id");
create index if not exists "mse_fk_workspaces_1" on "hospital"."workspaces" ("created_by");

