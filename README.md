# MSE Flow Systems

An operational capacity-planning workspace for hospital operations teams. It models aggregate unit-level bed pressure from census, arrivals, discharges, staffed capacity, and a selected planning horizon.

## Workflow

1. Import a CSV of aggregate unit snapshots (not patient rows).
2. Validate physical beds, staffed beds, occupancy, and daily flow rates.
3. Project occupancy over a 6-72 hour horizon using each unit's net admission/discharge flow.
4. Rank units by forecast occupancy relative to staffed capacity, identify projected overflow, and export the scenario.

Required columns: `unit,beds,occupied,admissions_24h,discharges_24h,staffed_beds,avg_los_hours`.

The model is a deterministic linear-flow scenario, not a clinical forecast. It does not account for acuity, transfer delays, changing arrival patterns, or patient-level length-of-stay distributions. It must not be used for triage or individual care decisions.

## Data and release status

Selected CSV data is processed in the browser and not uploaded. Do not include patient identifiers or protected health information. Authentication, shared workspaces, audit logs, hospital-system integration, validation with an operating partner, and automated tests remain before production deployment. This product is in active development and is not deployed.

## Run locally

```sh
npm install
npm run dev
```
