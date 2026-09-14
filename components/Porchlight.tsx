"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { RESIDENTS, RESIDENT_BY_ID, initialWorld } from "@/lib/seed";
import { fmtClock, reachedCount } from "@/lib/rules";
import type { NwsLive } from "@/lib/nws";
import type { AgentEvent, StreamMsg, World } from "@/lib/types";

const MapView = dynamic(() => import("./MapView"), { ssr: false, loading: () => <div className="map" /> });

type FeedItem = {
  key: number;
  kind: "event" | "tool" | "guardrail" | "agent" | "human" | "error";
  title: string;
  detail?: string;
  ok?: boolean;
  pending?: boolean;
};

const TOOL_LABEL: Record<string, string> = {
  check_heat_alert: "Check NWS heat alerts",
  score_residents: "Score heat risk",
  plan_checkins: "Plan volunteer routes",
  send_checkin_requests: "Text volunteers & residents",
  read_volunteer_inbox: "Read volunteer reports",
  record_note_outcome: "Classify volunteer note",
  escalate_to_coordinator: "Escalate to coordinator",
  request_welfare_check: "Request welfare check",
  dispatch_second_visit: "Dispatch second volunteer",
};

function Lamp() {
  return (
    <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden>
      <defs>
        <radialGradient id="glow" cx="50%" cy="55%" r="50%">
          <stop offset="0%" stopColor="#ffd28a" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#ff9a3c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="22" r="18" fill="url(#glow)" />
      <path d="M13 12h14l-2 4H15z" fill="#3a2c20" />
      <rect x="15" y="16" width="10" height="11" rx="2" fill="#ffc46b" />
      <path d="M14 27h12v2H14z" fill="#3a2c20" />
      <path d="M20 6v6" stroke="#3a2c20" strokeWidth="2" />
    </svg>
  );
}

export default function Porchlight() {
  const [world, setWorld] = useState<World>(initialWorld);
  const worldRef = useRef(world);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [nws, setNws] = useState<NwsLive | null>(null);
  const feedEl = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  const add = useCallback((item: Omit<FeedItem, "key">) => setFeed((f) => [...f, { ...item, key: ++seq.current }]), []);

  useEffect(() => {
    fetch("/api/nws")
      .then((r) => r.json())
      .then(setNws)
      .catch(() => setNws(null));
  }, []);

  useEffect(() => {
    feedEl.current?.scrollTo({ top: feedEl.current.scrollHeight, behavior: "smooth" });
  }, [feed]);

  const handle = useCallback(
    (m: StreamMsg) => {
      switch (m.type) {
        case "state":
          worldRef.current = m.world;
          setWorld(m.world);
          break;
        case "tool_call": {
          const input = m.input && typeof m.input === "object" && Object.keys(m.input).length ? JSON.stringify(m.input) : "";
          add({ kind: "tool", title: m.name, detail: input.length > 90 ? input.slice(0, 88) + "…" : input, pending: true });
          break;
        }
        case "tool_result":
          setFeed((f) => {
            const i = f.findLastIndex((x) => x.kind === "tool" && x.pending && x.title === m.name);
            if (i < 0) return f;
            const copy = [...f];
            copy[i] = { ...copy[i], pending: false, detail: m.summary };
            return copy;
          });
          break;
        case "guardrail":
          setFeed((f) => {
            // a blocked call never produces a result; stop its spinner
            const copy = m.ok ? f : f.map((x) => (x.kind === "tool" && x.pending && x.title === m.tool ? { ...x, pending: false, detail: "Blocked" } : x));
            return [...copy, { key: ++seq.current, kind: "guardrail", title: m.rule, detail: m.detail, ok: m.ok }];
          });
          break;
        case "text":
          if (m.text) add({ kind: "agent", title: "Porchlight agent", detail: m.text });
          break;
        case "error":
          add({ kind: "error", title: "Agent run failed", detail: m.message });
          break;
      }
    },
    [add],
  );

  const run = useCallback(
    async (event: AgentEvent, label: string, kind: FeedItem["kind"] = "event") => {
      if (busy) return;
      setBusy(true);
      add({ kind, title: label });
      try {
        const res = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, world: worldRef.current }) });
        if (!res.ok || !res.body) throw new Error((await res.text()) || res.statusText);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) handle(JSON.parse(line));
          }
        }
      } catch (e) {
        add({ kind: "error", title: "Agent run failed", detail: e instanceof Error ? e.message : String(e) });
      } finally {
        setBusy(false);
      }
    },
    [busy, add, handle],
  );

  const reset = () => {
    const w = initialWorld();
    worldRef.current = w;
    setWorld(w);
    setFeed([]);
  };

  const total = RESIDENTS.length;
  const reached = reachedCount(world);
  const high = RESIDENTS.filter((r) => world.residents[r.id].risk === "high").length;
  const outstanding = RESIDENTS.filter((r) => ["contacted", "retry", "no_answer", "escalated", "dispatched"].includes(world.residents[r.id].status)).length;
  const openDecision = world.decisions.find((d) => !d.resolved);
  const liveHeat = nws?.alerts.find((a) => /heat/i.test(a.event));
  const allReached = world.alert && reached === total;

  return (
    <main className={`app ${world.alert ? "alerting" : ""}`}>
      <section className="stage">
        <MapView world={world} />
        <div className="vignette" />

        <div className="counter" data-testid="counter">
          <div className={`counter-num ${allReached ? "done" : ""}`}>
            <span>{reached}</span>
            <small> of {total}</small>
          </div>
          <div className="counter-label">{allReached ? "neighbors reached. Nobody forgotten." : "neighbors reached"}</div>
          <div className="legend">
            <span><i className="lg rk-high" />high risk</span>
            <span><i className="lg rk-elevated" />elevated</span>
            <span><i className="lg rk-low" />lower</span>
            <span><i className="lg ok" />reached</span>
            <span><i className="lg cool">❄</i>cooling</span>
          </div>
        </div>

        <div className="clock">
          <span className="clock-k">Sim time</span>
          <span className="clock-v">{fmtClock(world.clock)}</span>
        </div>

        {openDecision &&
          (() => {
            const r = RESIDENT_BY_ID[openDecision.residentId];
            return (
              <div className="decision" data-testid="decision-card">
                <div className="decision-kicker">
                  <span className="dot" /> Needs your decision
                </div>
                <h3>
                  {r.name}, {r.age}
                </h3>
                <p className="decision-reason">{openDecision.reason}</p>
                <div className="chips">
                  {openDecision.facts.map((f) => (
                    <span key={f}>{f}</span>
                  ))}
                </div>
                <div className="decision-actions">
                  {openDecision.options.map((o, i) => (
                    <button
                      key={o.id}
                      className={i === 0 ? "btn-hot" : "btn-ghost"}
                      data-testid={`decision-${o.id}`}
                      disabled={busy}
                      onClick={() => run({ type: "decision", decisionId: openDecision.id, optionId: o.id }, `Coordinator approved: ${o.label}`, "human")}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <div className="decision-foot">Porchlight won&apos;t act until you choose. A Strands hook enforces it.</div>
              </div>
            );
          })()}
      </section>

      <aside className="side">
        <header className="brand">
          <Lamp />
          <div>
            <h1>Porchlight</h1>
            <p>Heat-wave welfare checks · Maryvale Neighbors, Phoenix AZ</p>
          </div>
          <button className="reset" data-testid="reset" onClick={reset} disabled={busy} title="Reset demo">
            Reset
          </button>
        </header>

        {world.alert ? (
          <div className="alert on" data-testid="alert">
            <div className="alert-top">
              <span className="alert-event">{world.alert.event}</span>
              <span className={`badge ${world.alert.source === "simulated" ? "sim" : "live"}`}>{world.alert.source === "simulated" ? "Simulated drill" : "Live NWS"}</span>
            </div>
            <div className="alert-body">{world.alert.headline}</div>
          </div>
        ) : (
          <div className="alert watching" data-testid="nws-live">
            <span className="pulse-dot" />
            <div>
              <div className="alert-event small">Watching the National Weather Service</div>
              <div className="alert-body">
                {nws?.ok
                  ? `Live for ${nws.place}: ${nws.tempF != null ? `${nws.tempF}°F, ${nws.shortForecast}. ` : ""}${liveHeat ? `${liveHeat.event} active.` : "No heat alerts right now."}`
                  : nws
                    ? "NWS unreachable right now."
                    : "Checking api.weather.gov…"}
              </div>
            </div>
          </div>
        )}

        <div className="stats">
          <div>
            <b>{world.scored ? high : "–"}</b>
            <span>high risk</span>
          </div>
          <div>
            <b>{world.alert ? outstanding : "–"}</b>
            <span>visits open</span>
          </div>
          <div className={openDecision ? "hot" : ""}>
            <b>{world.decisions.filter((d) => !d.resolved).length}</b>
            <span>need you</span>
          </div>
        </div>

        <div className="feed-head">
          <span>Agent activity</span>
          <span className="strands">Strands Agents SDK</span>
        </div>
        <div className="feed" ref={feedEl} data-testid="feed">
          {feed.length === 0 && (
            <div className="empty">
              Porchlight runs in the background. When a heat warning hits, it scores every enrolled neighbor, routes volunteers, reads their reports, and only interrupts you for real decisions.
            </div>
          )}
          {feed.map((f) => (
            <div key={f.key} className={`item ${f.kind} ${f.ok === false ? "blocked" : ""}`} data-testid={f.kind === "tool" ? "tool-call" : f.kind}>
              {f.kind === "tool" && (
                <>
                  <div className="item-row">
                    <span className={`spin ${f.pending ? "on" : ""}`}>{f.pending ? "" : "✓"}</span>
                    <span className="tool-name">{TOOL_LABEL[f.title] ?? f.title}</span>
                    <code>{f.title}</code>
                  </div>
                  {f.detail && <div className="item-detail">{f.detail}</div>}
                </>
              )}
              {f.kind === "guardrail" && (
                <div className="item-row">
                  <span className="shield">{f.ok ? "⛨" : "⛔"}</span>
                  <span className="g-label">{f.ok ? "Guardrail passed" : "Guardrail blocked"}</span>
                  <span className="g-rule">{f.title}</span>
                  <div className="item-detail full">{f.detail}</div>
                </div>
              )}
              {f.kind === "agent" && (
                <>
                  <div className="who">Porchlight agent</div>
                  <div className="bubble">{f.detail}</div>
                </>
              )}
              {f.kind === "human" && <div className="human-row">🧑 {f.title}</div>}
              {f.kind === "event" && <div className="event-row">{f.title}</div>}
              {f.kind === "error" && (
                <div className="err">
                  {f.title}: {f.detail}
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="working" data-testid="working">
              <span className="spin on" /> Strands agent is working…
            </div>
          )}
        </div>

        <div className="controls">
          {!world.alert && (
            <>
              <button className="btn-hot" data-testid="simulate-alert" disabled={busy} onClick={() => run({ type: "heat_check", simulate: true }, "Heat drill: simulate an Extreme Heat Warning")}>
                Simulate Extreme Heat Warning
              </button>
              <button className="btn-ghost" data-testid="live-check" disabled={busy} onClick={() => run({ type: "heat_check", simulate: false }, "Live check: National Weather Service")}>
                Run live NWS check
              </button>
            </>
          )}
          {world.alert && !openDecision && !allReached && (
            <button className="btn-hot" data-testid="advance" disabled={busy} onClick={() => run({ type: "inbox" }, `Fast-forward: volunteer reports arrive`)}>
              ⏩ Fast-forward · volunteer reports come in
            </button>
          )}
          {openDecision && <div className="waiting">A decision is waiting for you on the map.</div>}
          {allReached && <div className="waiting done">Everyone reached. Porchlight keeps watching the forecast.</div>}
          <div className="fineprint">Demo data: residents and volunteers are fictional. Weather is live from api.weather.gov unless marked simulated.</div>
        </div>
      </aside>
    </main>
  );
}
