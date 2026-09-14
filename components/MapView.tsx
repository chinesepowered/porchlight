"use client";

import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { COOLING, RESIDENTS, RESIDENT_BY_ID, VOLUNTEERS, VOLUNTEER_BY_ID } from "@/lib/seed";
import { REACHED } from "@/lib/rules";
import type { Resident, ResidentState, World } from "@/lib/types";

const BOUNDS: [[number, number], [number, number]] = [
  [33.4786, -112.2048],
  [33.5036, -112.1668],
];

const STATUS_TEXT: Record<ResidentState["status"], string> = {
  idle: "Not contacted",
  contacted: "Volunteer on the way",
  retry: "No answer · retry scheduled",
  no_answer: "Unreachable",
  escalated: "Waiting on coordinator",
  dispatched: "Help on the way",
  ok: "Reached · OK",
  cooling: "Reached · cooling ride",
  safe: "Reached · EMS",
};

function tag(r: Resident, s: ResidentState): string | null {
  const first = r.name.split(" ")[0];
  switch (s.status) {
    case "retry":
      return `${first} · no answer`;
    case "no_answer":
    case "escalated":
      return `${first} · needs you`;
    case "dispatched":
      return `${first} · help on the way`;
    case "cooling":
      return `${first} · ride to cooling`;
    case "safe":
      return `${first} · found, EMS`;
    default:
      return null;
  }
}

function hover(r: Resident, s: ResidentState) {
  const risk = s.risk ? `<span class="tip-risk rk-${s.risk}">${s.risk} risk · ${s.score}</span>` : "";
  const factors = s.factors?.length ? `<div class="tip-f">${s.factors.join(" · ")}</div>` : "";
  const vol = s.volunteerId ? `<div class="tip-f">Volunteer: ${VOLUNTEER_BY_ID[s.volunteerId].name}</div>` : "";
  return `<div class="tip-name">${r.name}, ${r.age}</div><div class="tip-f">${r.street}</div>${risk}${factors}${vol}<div class="tip-st">${s.outcome ?? STATUS_TEXT[s.status]}</div>`;
}

function icon(L: typeof Leaflet, id: string, s: ResidentState) {
  const reached = REACHED.has(s.status);
  const alarm = ["retry", "no_answer", "escalated"].includes(s.status);
  const glyph = reached ? "✓" : alarm ? "!" : "";
  const size = s.risk === "high" || alarm || s.status === "dispatched" ? 22 : 16;
  const cls = ["pin", `st-${s.status}`, `rk-${s.risk ?? "none"}`, reached ? "reached" : ""].join(" ");
  return L.divIcon({
    className: "pin-wrap",
    html: `<div class="${cls}" data-rid="${id}" style="width:${size}px;height:${size}px">${glyph}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

type Tagged = Leaflet.Marker & { _sig?: string; _tag?: string };

export default function MapView({ world }: { world: World }) {
  const el = useRef<HTMLDivElement>(null);
  const lib = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const pins = useRef(new Map<string, Tagged>());
  const routes = useRef<Leaflet.LayerGroup | null>(null);
  const routeKey = useRef("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let dead = false;
    import("leaflet").then((mod) => {
      const L = ((mod as unknown as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet;
      if (dead || !el.current || map.current) return;
      const m = L.map(el.current, { zoomControl: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, zoomSnap: 0.25 });
      m.fitBounds(BOUNDS, { padding: [10, 10] });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(m);
      routes.current = L.layerGroup().addTo(m);
      for (const c of COOLING) {
        L.marker([c.lat, c.lng], { icon: L.divIcon({ className: "pin-wrap", html: `<div class="cool-pin">❄</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }) })
          .bindTooltip(`<div class="tip-name">${c.name}</div><div class="tip-f">Cooling station</div>`, { direction: "top", className: "pl-tip", offset: [0, -12] })
          .addTo(m);
      }
      for (const v of VOLUNTEERS) {
        L.marker([v.lat, v.lng], {
          icon: L.divIcon({ className: "pin-wrap", html: `<div class="vol-pin" data-vid="${v.id}" style="--c:${v.color}">${v.initials}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
          zIndexOffset: 800,
        })
          .bindTooltip(`<div class="tip-name">${v.name}</div><div class="tip-f">Volunteer · up to ${v.capacity} visits</div>`, { direction: "top", className: "pl-tip", offset: [0, -14] })
          .addTo(m);
      }
      for (const r of RESIDENTS) pins.current.set(r.id, L.marker([r.lat, r.lng]).addTo(m) as Tagged);
      lib.current = L;
      map.current = m;
      setReady(true);
    });
    const pinMap = pins.current;
    return () => {
      dead = true;
      map.current?.remove();
      map.current = null;
      pinMap.clear();
    };
  }, []);

  useEffect(() => {
    const L = lib.current;
    if (!ready || !L || !map.current) return;
    for (const r of RESIDENTS) {
      const s = world.residents[r.id];
      const mk = pins.current.get(r.id);
      if (!mk) continue;
      const sig = `${s.status}|${s.risk}`;
      if (mk._sig !== sig) {
        mk.setIcon(icon(L, r.id, s));
        mk.setZIndexOffset(REACHED.has(s.status) ? 0 : s.risk === "high" ? 400 : 200);
        mk._sig = sig;
      }
      const t = tag(r, s);
      const tipSig = `${t}|${s.outcome}|${s.risk}|${s.volunteerId}`;
      if (mk._tag !== tipSig) {
        mk.unbindTooltip();
        if (t) mk.bindTooltip(t, { permanent: true, direction: "right", offset: [12, 0], className: `pl-tag tag-${s.status}` }).openTooltip();
        else mk.bindTooltip(hover(r, s), { direction: "top", className: "pl-tip", offset: [0, -10] });
        mk._tag = tipSig;
      }
    }
    const key = JSON.stringify(world.routes);
    if (key !== routeKey.current && routes.current) {
      routeKey.current = key;
      routes.current.clearLayers();
      Object.entries(world.routes).forEach(([vid, stops], i) => {
        const v = VOLUNTEER_BY_ID[vid];
        const pts = [[v.lat, v.lng] as [number, number], ...stops.map((id) => [RESIDENT_BY_ID[id].lat, RESIDENT_BY_ID[id].lng] as [number, number])];
        const line = L.polyline(pts, { color: v.color, weight: 3, opacity: 0.9, lineJoin: "round", className: "route-line" }).addTo(routes.current!);
        const path = (line as unknown as { _path?: SVGPathElement })._path;
        if (path) path.style.animationDelay = `${i * 0.25}s`;
      });
    }
  }, [world, ready]);

  return <div ref={el} className="map" data-testid="map" />;
}
