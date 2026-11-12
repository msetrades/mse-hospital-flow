"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { projectUnits, type Projection, type Unit } from "@/lib/flow";

type Snapshot = { id: string; name: string; observed_at: string };
type Scenario = { id: string; name: string; horizon_hours: number; created_at: string };
const HEADERS = ["unit", "beds", "occupied", "admissions_24h", "discharges_24h", "staffed_beds", "avg_los_hours"];

function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && text[i + 1] === '"' && quoted) { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parse(text: string): Unit[] {
  const rows = readCsv(text);
  if (rows.length < 2) throw new Error("Upload one aggregate unit row, not patient records.");
  if (rows.length > 201) throw new Error("A snapshot can contain up to 200 units.");
  const headers = rows[0].map((value) => value.toLowerCase());
  const missing = HEADERS.filter((key) => !headers.includes(key));
  const extras = headers.filter((key) => !HEADERS.includes(key));
  if (missing.length || extras.length) {
    const details = [missing.length ? `Missing: ${missing.join(", ")}` : "", extras.length ? `Unexpected columns: ${extras.join(", ")}` : ""].filter(Boolean).join(". ");
    throw new Error(`${details}. Use only: ${HEADERS.join(", ")}.`);
  }
  if (new Set(headers).size !== HEADERS.length) throw new Error("CSV headers must not repeat.");
  const col = (key: string) => headers.indexOf(key);
  const units = rows.slice(1).map((values, i) => {
    if (values.length !== HEADERS.length) throw new Error(`Row ${i + 2} does not have exactly ${HEADERS.length} fields.`);
    const unit: Unit = {
      name: values[col("unit")], beds: Number(values[col("beds")]), occupied: Number(values[col("occupied")]),
      admissions: Number(values[col("admissions_24h")]), discharges: Number(values[col("discharges_24h")]),
      staffed: Number(values[col("staffed_beds")]), los: Number(values[col("avg_los_hours")]),
    };
    if (!unit.name || unit.name.length > 120 || ![unit.beds, unit.occupied, unit.admissions, unit.discharges, unit.staffed, unit.los].every(Number.isFinite) ||
      ![unit.beds, unit.occupied, unit.staffed].every(Number.isInteger) || unit.beds <= 0 || unit.occupied < 0 || unit.occupied > unit.beds ||
      unit.admissions < 0 || unit.discharges < 0 || unit.staffed < 0 || unit.staffed > unit.beds || unit.los <= 0) {
      throw new Error(`Invalid aggregate values on row ${i + 2}. Check bed counts, non-negative daily flows, and average LOS.`);
    }
    return unit;
  });
  if (new Set(units.map((unit) => unit.name.toLocaleLowerCase())).size !== units.length) throw new Error("Unit names must be unique within a census snapshot.");
  return units;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [activeSnapshotId, setActiveSnapshotId] = useState("");
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [hours, setHours] = useState(24);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const userId = session?.user.id;

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next); setAuthReady(true); setWorkspaceId(""); setWorkspaceReady(false);
      setSnapshots([]); setActiveSnapshotId(""); setUnits([]); setScenarios([]);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !userId) return;
    let cancelled = false;
    void supabase.schema("hospital").from("workspaces").select("id,name").order("created_at").limit(1).then(({ data, error: loadError }) => {
      if (cancelled) return;
      if (loadError) { setError(`Could not open workspace: ${loadError.message}`); setWorkspaceReady(true); return; }
      const workspace = data?.[0];
      if (!workspace) { setWorkspaceReady(true); return; }
      setWorkspaceId(workspace.id); setWorkspaceName(workspace.name);
    });
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!supabase || !workspaceId) return;
    let cancelled = false;
    void Promise.all([
      supabase.schema("hospital").from("census_snapshots").select("id,name,observed_at").eq("workspace_id", workspaceId).order("observed_at", { ascending: false }).limit(40),
      supabase.schema("hospital").from("capacity_scenarios").select("id,name,horizon_hours,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(20),
    ]).then(([snapshotResult, scenarioResult]) => {
      if (cancelled) return;
      if (snapshotResult.error) setError(`Could not load census history: ${snapshotResult.error.message}`);
      else {
        const history = snapshotResult.data ?? [];
        setSnapshots(history);
        setActiveSnapshotId((active) => active || history[0]?.id || "");
      }
      if (scenarioResult.error) setError(`Could not load scenario history: ${scenarioResult.error.message}`);
      else setScenarios(scenarioResult.data ?? []);
      setWorkspaceReady(true);
    });
    return () => { cancelled = true; };
  }, [workspaceId]);

  useEffect(() => {
    if (!supabase || !workspaceId || !activeSnapshotId) return;
    let cancelled = false;
    void supabase.schema("hospital").from("unit_capacity")
      .select("id,unit_name,physical_beds,occupied,admissions_24h,discharges_24h,staffed_beds,average_los_hours")
      .eq("workspace_id", workspaceId).eq("snapshot_id", activeSnapshotId).order("unit_name")
      .then(({ data, error: loadError }) => {
        if (cancelled) return;
        if (loadError) setError(`Could not load unit data: ${loadError.message}`);
        else setUnits((data ?? []).map((row) => ({ id: row.id, name: row.unit_name, beds: row.physical_beds, occupied: row.occupied, admissions: Number(row.admissions_24h), discharges: Number(row.discharges_24h), staffed: row.staffed_beds, los: Number(row.average_los_hours) })));
      });
    return () => { cancelled = true; };
  }, [workspaceId, activeSnapshotId]);

  const projections = useMemo<Projection[]>(() => projectUnits(units, hours), [units, hours]);
  const totals = projections.reduce((sum, unit) => ({ staffed: sum.staffed + unit.capacity, occupied: sum.occupied + unit.occupied, forecast: sum.forecast + unit.forecast, spill: sum.spill + unit.spillover }), { staffed: 0, occupied: 0, forecast: 0, spill: 0 });

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!supabase) return;
    setBusy(true); setAuthMessage("");
    const result = authMode === "signup"
      ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
      : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (result.error) setAuthMessage(result.error.message);
    else if (authMode === "signup" && !result.data.session) setAuthMessage("Check your email to confirm your account, then sign in here.");
  };

  const createWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!supabase || !session?.user.id) return;
    setBusy(true); setError("");
    const { data, error: createError } = await supabase.schema("hospital").from("workspaces")
      .insert({ name: workspaceName.trim(), created_by: session.user.id }).select("id,name").single();
    setBusy(false);
    if (createError) setError(`Could not create workspace: ${createError.message}`);
    else { setWorkspaceId(data.id); setWorkspaceName(data.name); setWorkspaceReady(false); }
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file || !supabase || !session?.user.id || !workspaceId) return;
    setBusy(true); setError(""); setMessage("");
    let snapshotId = "";
    try {
      const parsed = parse(await file.text());
      const { data: snapshot, error: snapshotError } = await supabase.schema("hospital").from("census_snapshots")
        .insert({ workspace_id: workspaceId, name: `Unit census · ${new Date().toLocaleString()}`, source_name: "Aggregate CSV upload", created_by: session.user.id })
        .select("id,name,observed_at").single();
      if (snapshotError) throw snapshotError;
      snapshotId = snapshot.id;
      const { data: savedUnits, error: unitsError } = await supabase.schema("hospital").from("unit_capacity").insert(parsed.map((unit) => ({
        workspace_id: workspaceId, snapshot_id: snapshot.id, unit_name: unit.name, physical_beds: unit.beds, occupied: unit.occupied,
        admissions_24h: unit.admissions, discharges_24h: unit.discharges, staffed_beds: unit.staffed,
        average_los_hours: unit.los, created_by: session.user.id,
      }))).select("id,unit_name,physical_beds,occupied,admissions_24h,discharges_24h,staffed_beds,average_los_hours");
      if (unitsError) throw unitsError;
      setSnapshots((old) => [snapshot, ...old]); setActiveSnapshotId(snapshot.id);
      setUnits((savedUnits ?? []).map((row) => ({ id: row.id, name: row.unit_name, beds: row.physical_beds, occupied: row.occupied, admissions: Number(row.admissions_24h), discharges: Number(row.discharges_24h), staffed: row.staffed_beds, los: Number(row.average_los_hours) })));
      setFileName(file.name); setMessage(`${parsed.length} aggregate unit records saved as a private census snapshot.`);
    } catch (cause) {
      if (snapshotId) await supabase.schema("hospital").from("census_snapshots").delete().eq("id", snapshotId);
      setError(cause instanceof Error ? cause.message : "Could not save the aggregate census.");
    } finally { setBusy(false); }
  };

  const saveScenario = async () => {
    if (!supabase || !session?.user.id || !workspaceId || !activeSnapshotId || !projections.length || projections.some((unit) => !unit.id)) return;
    setBusy(true); setError(""); setMessage("");
    const { data: scenario, error: scenarioError } = await supabase.schema("hospital").from("capacity_scenarios")
      .insert({ workspace_id: workspaceId, snapshot_id: activeSnapshotId, name: `${hours}-hour capacity scenario · ${new Date().toLocaleDateString()}`, horizon_hours: hours, assumptions: { model: "linear_net_flow_v1", flow_rate_basis: "per_24h" }, created_by: session.user.id })
      .select("id,name,horizon_hours,created_at").single();
    if (scenarioError) { setError(`Could not save scenario: ${scenarioError.message}`); setBusy(false); return; }
    const { error: itemError } = await supabase.schema("hospital").from("scenario_units").insert(projections.map((unit, index) => ({
      workspace_id: workspaceId, snapshot_id: activeSnapshotId, scenario_id: scenario.id, unit_capacity_id: unit.id,
      projected_occupancy: Number(unit.forecast.toFixed(2)), capacity_pressure: Number((Number.isFinite(unit.pressure) ? unit.pressure : 99_999).toFixed(5)),
      spillover_beds: Number(unit.spillover.toFixed(2)), priority_rank: index + 1,
    })));
    setBusy(false);
    if (itemError) setError(`Scenario started saving, but its unit results failed: ${itemError.message}`);
    else { setScenarios((old) => [scenario, ...old]); setMessage("Scenario and unit-level results saved to the private workspace."); }
  };

  const download = () => {
    const rows = [HEADERS.concat(["forecast_occupied", "pressure_pct", "spillover_beds"])];
    const csv = [rows[0].join(","), ...projections.map((unit) => [unit.name, unit.beds, unit.occupied, unit.admissions, unit.discharges, unit.staffed, unit.los, unit.forecast.toFixed(1), Number.isFinite(unit.pressure) ? (unit.pressure * 100).toFixed(1) : "", unit.spillover.toFixed(1)].map(csvCell).join(","))].join("\n");
    const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); anchor.download = "hospital-capacity-scenario.csv"; anchor.click(); URL.revokeObjectURL(anchor.href);
  };

  if (!supabase) return <main className="auth-shell"><section className="auth-card"><p className="flow-kicker">MSE FLOW SYSTEMS</p><h1>Setup required</h1><p>Add the Supabase project URL and publishable key to the app environment.</p></section></main>;
  if (!authReady) return <main className="auth-shell"><section className="auth-card"><p className="flow-kicker">MSE FLOW SYSTEMS</p><h1>Opening your workspace…</h1></section></main>;
  if (!session) return <main className="auth-shell"><section className="auth-card"><p className="flow-kicker">HOSPITAL OPERATIONS / PRIVATE WORKSPACE</p><h1>{authMode === "signin" ? "See pressure sooner." : "Create your workspace."}</h1><p>Plan with aggregate capacity data. The product does not need or accept patient-level records.</p><form onSubmit={submitAuth} className="auth-form"><label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input type="password" autoComplete={authMode === "signin" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="primary" disabled={busy}>{busy ? "Working…" : authMode === "signin" ? "Sign in" : "Create account"}</button></form>{authMessage && <p className="auth-message" role="status">{authMessage}</p>}<button className="text-button" onClick={() => { setAuthMode(authMode === "signin" ? "signup" : "signin"); setAuthMessage(""); }}>{authMode === "signin" ? "New here? Create an account" : "Already registered? Sign in"}</button></section></main>;
  if (!workspaceId && workspaceReady) return <main className="auth-shell"><section className="auth-card"><p className="flow-kicker">START A PRIVATE WORKSPACE</p><h1>Give your operations team a view of flow.</h1><p>Store unit-level aggregates and planning scenarios. Keep patient identifiers and notes out of this system.</p><form onSubmit={createWorkspace} className="auth-form"><label>Hospital or operations team<input required minLength={2} maxLength={120} value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="e.g. North District Hospital" /></label><button className="primary" disabled={busy}>{busy ? "Creating…" : "Create workspace"}</button></form>{error && <p className="auth-message error-text" role="alert">{error}</p>}</section></main>;
  if (!workspaceReady || !workspaceId) return <main className="auth-shell"><section className="auth-card"><p className="flow-kicker">MSE FLOW SYSTEMS</p><h1>Loading secure workspace…</h1></section></main>;

  return <main className="flow-shell"><aside className="flow-rail"><div className="flow-brand"><b>F</b><span>MSE / FLOW SYSTEMS</span></div><nav><a className="on" href="#capacity">Capacity control</a><a href="#pressure">Unit pressure</a><a href="#history">Scenario history</a><a href="#method">Data assumptions</a></nav><div className="rail-foot">OPERATIONS RESEARCH<br/><small>Aggregate data only. No patient records.</small></div></aside>
    <section className="flow-main" id="capacity"><header className="flow-top"><span>HOSPITAL OPERATIONS / {workspaceName.toUpperCase()}</span><span className="account">{session.user.email}<button onClick={() => supabase?.auth.signOut()}>Sign out</button></span></header>
      {message && <p className="auth-message">{message}</p>}{error && <div className="flow-error" role="alert">{error}</div>}
      <section className="flow-hero"><div><p className="flow-kicker">BED CAPACITY / AGGREGATE FLOW</p><h1>See the bottleneck<br/>before the shift.</h1><p>Project unit-level bed pressure from aggregate occupancy, arrivals, discharges, staffed capacity, and average length of stay. Compare planning horizons without patient-level data.</p></div><span className="flow-number">02 <i>/ 10</i></span></section>
      <section className="flow-upload"><div><small>01 / AGGREGATE CENSUS</small><h2>Bring a unit snapshot</h2><p>Exactly these CSV fields: {HEADERS.join(", ")}. Do not include patient names, IDs, notes, or other personal information.</p></div><label className="flow-button">{busy ? "Saving…" : fileName || "Import census CSV"}<input type="file" accept=".csv,text/csv" disabled={busy} onChange={onFile}/></label></section>
      <section className="flow-control"><div><small>02 / PLANNING HORIZON</small><h2>Project the next <strong>{hours} hours</strong></h2></div><input aria-label="Projection horizon in hours" type="range" min="6" max="72" step="6" value={hours} onChange={(event) => setHours(Number(event.target.value))}/><span>{hours}h</span></section>
      <section className="flow-stats"><article><small>STAFFED CAPACITY</small><strong>{units.length ? totals.staffed : "—"}</strong><span>Available staffed beds</span></article><article><small>PROJECTED OCCUPANCY</small><strong>{units.length ? totals.forecast.toFixed(0) : "—"}</strong><span>At {hours}-hour horizon</span></article><article className={totals.spill ? "alert" : ""}><small>CAPACITY GAP</small><strong>{units.length ? totals.spill.toFixed(0) : "—"}</strong><span>Beds beyond staffed capacity</span></article></section>
      <section className="flow-panel" id="pressure"><div className="flow-panel-head"><div><small>03 / PRESSURE MAP</small><h2>Units requiring attention</h2></div><div className="flow-actions"><button onClick={saveScenario} disabled={!projections.length || busy || projections.some((unit) => !unit.id)}>{busy ? "Saving…" : "Save scenario"}</button><button onClick={download} disabled={!units.length}>Export CSV ↗</button></div></div>
        {snapshots.length > 0 && <label className="snapshot-select">Census snapshot<select value={activeSnapshotId} onChange={(event) => setActiveSnapshotId(event.target.value)}>{snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshot.name} · {new Date(snapshot.observed_at).toLocaleString()}</option>)}</select></label>}
        {projections.length ? <div className="flow-units">{projections.map((unit) => <article className="unit-row" key={unit.id ?? unit.name}><div className="unit-label"><b>{unit.name}</b><small>{unit.occupied} occupied · {unit.capacity} staffed · {unit.admissions} arrivals / 24h</small></div><div className="pressure-track"><i style={{ width: `${Math.min(100, unit.pressure * 100)}%` }} className={unit.pressure >= .95 ? "critical" : unit.pressure >= .8 ? "watch" : "steady"}/></div><b className={unit.pressure >= .95 ? "critical-text" : unit.pressure >= .8 ? "watch-text" : "steady-text"}>{Number.isFinite(unit.pressure) ? `${Math.round(unit.pressure * 100)}%` : "Unstaffed"}</b><span>{unit.spillover ? `${unit.spillover.toFixed(0)} over` : "Within plan"}</span></article>)}</div> : <div className="flow-empty"><b>NO CENSUS LOADED</b><p>Load an aggregate unit snapshot to simulate occupancy and identify staffing pressure.</p><small>No sample hospital or patient records are inserted.</small></div>}
        <div className="flow-method" id="method"><b>MODEL NOTE</b><span>Linear net-flow projection: current occupancy + (admissions/day − discharges/day) × horizon. This is a planning scenario, not a clinical prediction; rates may vary by shift and unit. It does not account for acuity, transfers, or changing arrival patterns.</span></div>
      </section>
      <section className="scenario-history" id="history"><div className="history-heading"><div><small>04 / SAVED WORK</small><h2>Census &amp; scenario history</h2></div></div><div className="history-grid"><article><strong>{snapshots.length}</strong><span>Aggregate snapshots saved</span><small>Switch between prior unit-census uploads above.</small></article><article><strong>{scenarios.length}</strong><span>Planning scenarios saved</span><small>{scenarios.slice(0, 4).map((scenario) => `${scenario.name} · ${scenario.horizon_hours}h`).join(" | ") || "Saved horizons and pressure results will appear here."}</small></article></div></section>
      <footer className="flow-footer"><span>MSE FLOW SYSTEMS / WORKSPACE-PRIVATE</span><span>Do not use for triage or individual patient decisions.</span></footer>
    </section>
  </main>;
}
