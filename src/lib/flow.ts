export type Unit = { id?: string; name: string; beds: number; occupied: number; admissions: number; discharges: number; staffed: number; los: number };
export type Projection = Unit & { forecast: number; capacity: number; pressure: number; spillover: number };

export function projectUnits(units: Unit[], hours: number): Projection[] {
  if (!Number.isFinite(hours) || hours < 0 || hours > 168) throw new Error("Forecast horizon must be between 0 and 168 hours.");
  return units.map((unit) => {
    const projected = Math.max(0, unit.occupied + (unit.admissions - unit.discharges) * hours / 24);
    const capacity = Math.min(unit.beds, unit.staffed);
    return {
      ...unit,
      forecast: projected,
      capacity,
      pressure: capacity ? projected / capacity : Number.POSITIVE_INFINITY,
      spillover: Math.max(0, projected - capacity),
    };
  }).sort((a, b) => b.pressure - a.pressure);
}
