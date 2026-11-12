"use client";

import { useMemo, useState, type ChangeEvent } from "react";

type Unit = { name: string; beds: number; occupied: number; admissions: number; discharges: number; staffed: number; los: number };
type Projection = Unit & { forecast: number; capacity: number; pressure: number; spillover: number; throughput: number };

function parse(text: string): Unit[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("Upload an aggregate unit census with at least one data row.");
  const headers = lines[0].split(",").map((value) => value.trim().toLowerCase());
  const required = ["unit", "beds", "occupied", "admissions_24h", "discharges_24h", "staffed_beds", "avg_los_hours"];
  const missing = required.filter((key) => !headers.includes(key));
  if (missing.length) throw new Error(`Missing CSV fields: ${missing.join(", ")}`);
  const ix = (key: string) => headers.indexOf(key);
  return lines.slice(1).map((line, i) => {
    const row = line.split(",").map((v) => v.trim());
    const u: Unit = { name: row[ix("unit")], beds: Number(row[ix("beds")]), occupied: Number(row[ix("occupied")]), admissions: Number(row[ix("admissions_24h")]), discharges: Number(row[ix("discharges_24h")]), staffed: Number(row[ix("staffed_beds")]), los: Number(row[ix("avg_los_hours")]) };
    if (!u.name || ![u.beds,u.occupied,u.admissions,u.discharges,u.staffed,u.los].every(Number.isFinite) || u.beds <= 0 || u.occupied < 0 || u.occupied > u.beds || u.admissions < 0 || u.discharges < 0 || u.staffed < 0 || u.staffed > u.beds || u.los <= 0) throw new Error(`Invalid aggregate values in row ${i + 2}. Occupancy must not exceed physical beds; staffing must be between zero and beds.`);
    return u;
  });
}

export default function Home() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [hours, setHours] = useState(24);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const projections = useMemo<Projection[]>(() => units.map((u) => {
    const factor = hours / 24;
    const projected = Math.max(0, u.occupied + (u.admissions - u.discharges) * factor);
    const capacity = Math.min(u.beds, u.staffed);
    return { ...u, forecast: projected, capacity, pressure: capacity ? projected / capacity : Infinity, spillover: Math.max(0, projected - capacity), throughput: u.los ? (24 / u.los) * u.occupied : 0 };
  }).sort((a,b) => b.pressure - a.pressure), [units, hours]);
  const totals = projections.reduce((a,u) => ({ staffed: a.staffed + u.capacity, occupied: a.occupied + u.occupied, arrivals: a.arrivals + u.admissions * hours / 24, expected: a.expected + u.forecast, spill: a.spill + u.spillover }), { staffed: 0, occupied: 0, arrivals: 0, expected: 0, spill: 0 });
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (!file) return; try { const parsed = parse(await file.text()); setUnits(parsed); setFileName(file.name); setError(""); } catch (x) { setUnits([]); setError(x instanceof Error ? x.message : "Could not read the file."); } };
  const download = () => { const csv = ["unit,staffed_capacity,current_occupied,admissions_horizon,forecast_occupied,forecast_pressure_pct,spillover_beds", ...projections.map((u) => [u.name,u.capacity,u.occupied,(u.admissions*hours/24).toFixed(1),u.forecast.toFixed(1),(u.pressure*100).toFixed(1),u.spillover.toFixed(1)].join(","))].join("\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"})); a.download = "capacity-scenario.csv"; a.click(); URL.revokeObjectURL(a.href); };
  return <main className="flow-shell"><aside className="flow-rail"><div className="flow-brand"><b>F</b><span>MSE / FLOW SYSTEMS</span></div><nav><a className="on">Capacity control</a><a>Unit pressure</a><a>Scenario planner</a><a>Data assumptions</a></nav><div className="rail-foot">OPERATIONS RESEARCH<br/><small>Aggregate data only. No patient records are needed.</small></div></aside><section className="flow-main"><header className="flow-top"><span>HOSPITAL OPERATIONS / CAPACITY MODEL</span><span>● LOCAL WORKSPACE</span></header><section className="flow-hero"><div><p className="flow-kicker">BED CAPACITY / PATIENT FLOW</p><h1>See the bottleneck<br/>before the shift.</h1><p>Project unit-level bed pressure from current occupancy, expected arrivals, discharge throughput, and staffed capacity. Test a planning horizon without exposing patient-level data.</p></div><span className="flow-number">02 <i>/ 10</i></span></section>
  <section className="flow-upload"><div><small>01 / AGGREGATE CENSUS</small><h2>Bring a unit snapshot</h2><p>CSV: unit, beds, occupied, admissions_24h, discharges_24h, staffed_beds, avg_los_hours</p></div><label className="flow-button">{fileName || "Import census CSV"}<input type="file" accept=".csv,text/csv" onChange={onFile}/></label></section>{error && <div className="flow-error" role="alert">{error}</div>}
  <section className="flow-control"><div><small>02 / PLANNING HORIZON</small><h2>Project the next <strong>{hours} hours</strong></h2></div><input aria-label="Projection horizon in hours" type="range" min="6" max="72" step="6" value={hours} onChange={(e)=>setHours(Number(e.target.value))}/><span>{hours}h</span></section>
  <section className="flow-stats"><article><small>STAFFED CAPACITY</small><strong>{units.length ? totals.staffed : "—"}</strong><span>Available staffed beds</span></article><article><small>PROJECTED OCCUPANCY</small><strong>{units.length ? totals.expected.toFixed(0) : "—"}</strong><span>At {hours}-hour horizon</span></article><article className={totals.spill ? "alert" : ""}><small>CAPACITY GAP</small><strong>{units.length ? totals.spill.toFixed(0) : "—"}</strong><span>Beds beyond staffed capacity</span></article></section>
  <section className="flow-panel"><div className="flow-panel-head"><div><small>03 / PRESSURE MAP</small><h2>Units requiring attention</h2></div><button onClick={download} disabled={!units.length}>Export scenario ↗</button></div>{projections.length ? <div className="flow-units">{projections.map((u)=> <article className="unit-row" key={u.name}><div className="unit-label"><b>{u.name}</b><small>{u.occupied} occupied · {u.capacity} staffed capacity · {u.admissions} arrivals/day</small></div><div className="pressure-track"><i style={{width:`${Math.min(100,u.pressure*100)}%`}} className={u.pressure>=.95?"critical":u.pressure>=.8?"watch":"steady"}/></div><b className={u.pressure>=.95?"critical-text":u.pressure>=.8?"watch-text":"steady-text"}>{Number.isFinite(u.pressure)?`${Math.round(u.pressure*100)}%`:"Unstaffed"}</b><span>{u.spillover?`${u.spillover.toFixed(0)} over`:"Within plan"}</span></article>)}</div> : <div className="flow-empty"><b>NO CENSUS LOADED</b><p>Load an aggregated unit snapshot to simulate occupancy and identify staffing-capacity pressure.</p><small>Rows are validated locally; no sample hospital or patient records are included.</small></div>}<div className="flow-method"><b>MODEL NOTE</b><span>Linear net-flow projection: current occupancy + (admissions/day − discharges/day) × horizon. This is a planning scenario, not a clinical prediction; rates may vary by shift and unit.</span></div></section><footer className="flow-footer"><span>MSE FLOW SYSTEMS / OPERATIONAL PLANNING</span><span>Do not use for triage or individual patient decisions.</span></footer></section></main>;
}
