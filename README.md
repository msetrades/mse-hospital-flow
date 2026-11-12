# MSE Flow Systems

An authenticated hospital operations workspace for aggregate bed-capacity snapshots, pressure projections, and saved planning scenarios. It is designed to help operations teams compare unit-level capacity constraints without collecting patient-level records.

## Workflow

1. Create an account and a private operations workspace.
2. Import a unit-level CSV with exactly these headers: `unit,beds,occupied,admissions_24h,discharges_24h,staffed_beds,avg_los_hours`.
3. Review validated occupancy, staffed capacity, arrivals, discharges, and projected spillover.
4. Choose a 6-72 hour horizon in six-hour steps, save the scenario, or export the result as CSV.
5. Reopen older aggregate snapshots and inspect saved scenario history.

## Model boundaries

The projection is `current occupancy + (admissions per 24h - discharges per 24h) * horizon / 24`, floored at zero. Capacity pressure uses the lower of physical and staffed beds. This is a transparent linear-flow scenario, not a clinical forecast, capacity guarantee, or staffing recommendation. It does not model acuity, patient-level length of stay, transfers, cancellations, or time-varying arrival patterns. Never use it for triage or individual care decisions.

## Privacy and access

- The CSV is parsed in the browser and only approved aggregate fields are stored in the app's dedicated `hospital` schema.
- Patient names, identifiers, notes, and extra CSV columns are rejected by the importer. Do not place PHI in unit names or workspace labels.
- Supabase email authentication is required; row-level security scopes records to the workspace owner. Anonymous table privileges are revoked.
- This is not represented as HIPAA-certified or as a substitute for a hospital's approved data governance controls. Workspace collaboration, invitations, retention controls, and an audit interface are not implemented.

## Local setup

Create `.env.local` from `.env.example` and add the Supabase project URL and publishable key. Never put a service-role or secret key in the browser.

```sh
npm install
npm run dev
```

## Release status

The authenticated core workflow is deployed, but the product is still under validation. Before operational adoption, validate assumptions with hospital operations partners, review privacy/security and retention requirements, complete accessibility and end-to-end tests, and establish support and incident procedures.
