// Deterministic business rules. The agent calls these through tools; the LLM never scores or assigns.
import { COOLING, RESIDENTS, VOLUNTEERS } from "./seed";
import type { Resident, Risk, Status, World } from "./types";

export const REACHED: ReadonlySet<Status> = new Set(["ok", "cooling", "safe"]);
export const MAX_MESSAGES_PER_HOUR = 2;
export const MAX_TOOL_CALLS = 14;

// Risk factors follow the BC Coroners Service 2021 heat-dome review (age, living alone, no cooling,
// chronic disease) and CDC guidance on heat-sensitive medications.
export function scoreResident(r: Resident): { score: number; risk: Risk; factors: string[] } {
  let score = 0;
  const factors: string[] = [];
  if (r.age >= 80) (score += 3), factors.push(`age ${r.age}`);
  else if (r.age >= 70) (score += 2), factors.push(`age ${r.age}`);
  else if (r.age >= 65) score += 1;
  if (r.livesAlone) (score += 2), factors.push("lives alone");
  if (r.ac !== "working") (score += 3), factors.push(r.ac === "none" ? "no AC" : "AC broken");
  if (r.heatMeds.length) (score += 2), factors.push(...r.heatMeds);
  if (r.limitedMobility) (score += 1), factors.push("limited mobility");
  if (r.topFloor) (score += 1), factors.push("top-floor unit");
  const risk: Risk = score >= 7 ? "high" : score >= 4 ? "elevated" : "low";
  return { score, risk, factors };
}

export function miles(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Greedy assignment: highest-risk residents pick first, each goes to the nearest volunteer with capacity.
// Each route then visits high-risk stops first, in nearest-neighbor order.
export function planRoutes(world: World): Record<string, string[]> {
  const load: Record<string, string[]> = Object.fromEntries(VOLUNTEERS.map((v) => [v.id, []]));
  const order = [...RESIDENTS].sort((a, b) => (world.residents[b.id].score ?? 0) - (world.residents[a.id].score ?? 0) || a.id.localeCompare(b.id));
  for (const r of order) {
    const v = VOLUNTEERS.filter((x) => load[x.id].length < x.capacity).sort((x, y) => miles(r, x) - miles(r, y))[0];
    if (v) load[v.id].push(r.id);
  }
  const routes: Record<string, string[]> = {};
  for (const v of VOLUNTEERS) {
    const stops = load[v.id].map((id) => RESIDENTS.find((r) => r.id === id)!);
    const ordered: Resident[] = [];
    let at: { lat: number; lng: number } = v;
    for (const tier of [stops.filter((s) => world.residents[s.id].risk === "high"), stops.filter((s) => world.residents[s.id].risk !== "high")]) {
      const left = [...tier];
      while (left.length) {
        left.sort((x, y) => miles(at, x) - miles(at, y));
        const next = left.shift()!;
        ordered.push(next);
        at = next;
      }
    }
    if (ordered.length) routes[v.id] = ordered.map((r) => r.id);
  }
  return routes;
}

export function routeMiles(world: World, volunteerId: string) {
  const v = VOLUNTEERS.find((x) => x.id === volunteerId)!;
  let at: { lat: number; lng: number } = v;
  let total = 0;
  for (const id of world.routes[volunteerId] ?? []) {
    const r = RESIDENTS.find((x) => x.id === id)!;
    total += miles(at, r);
    at = r;
  }
  return Math.round(total * 10) / 10;
}

export function nearestCooling(r: Resident) {
  const c = [...COOLING].sort((a, b) => miles(r, a) - miles(r, b))[0];
  return { center: c, miles: Math.round(miles(r, c) * 10) / 10 };
}

export function messagesLastHour(world: World, residentId: string) {
  return world.residents[residentId].messages.filter((t) => world.clock - t < 60).length;
}

export function reachedCount(world: World) {
  return RESIDENTS.filter((r) => REACHED.has(world.residents[r.id].status)).length;
}

export function fmtClock(min: number) {
  const h = Math.floor(min / 60);
  const m = String(min % 60).padStart(2, "0");
  return `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}
