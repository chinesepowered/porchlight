// Porchlight's Strands agent: tools do the deterministic work, hooks enforce guardrails,
// and the model decides the order of work and reads volunteers' free-text notes.
import { Agent, BeforeToolCallEvent, tool } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { z } from "zod";
import { fetchNws } from "./nws";
import { MAX_MESSAGES_PER_HOUR, MAX_TOOL_CALLS, REACHED, fmtClock, messagesLastHour, miles, nearestCooling, planRoutes, reachedCount, routeMiles, scoreResident } from "./rules";
import { NOTE_RESIDENTS, RESIDENTS, RESIDENT_BY_ID, ROUNDS, VOLUNTEERS, VOLUNTEER_BY_ID, initialWorld, noteFor } from "./seed";
import type { AgentEvent, Decision, StreamMsg, World } from "./types";

const SYSTEM_PROMPT = `You are Porchlight, a Strands agent that runs heat-wave welfare checks for Maryvale Neighbors, a volunteer mutual-aid group in Phoenix, Arizona.
You work in the background and only involve the human coordinator when a real decision is needed.
Your tools do all risk scoring, volunteer assignment, messaging and record keeping. Never invent residents, numbers or outcomes; use only what tools return.
When you classify a volunteer's note, read it carefully: "ok" means the resident was reached and is fine; "needs_cooling" means reached but their home is dangerously hot or they need a ride somewhere cool; "no_answer" means nobody could reach them; "emergency_handled" means they were found in trouble and emergency services took over.
Some actions are protected by guardrails. If a tool call is blocked, read the reason, do not repeat the same call, and follow the guidance in the message.
Never mention internal ids (like r01 or n2) in text meant for people. Escalation reasons are one plain sentence of at most 25 words.
After the tool calls, reply with a status update for the coordinator: at most two short sentences, plain text, no markdown.`;

function promptFor(event: AgentEvent, world: World) {
  switch (event.type) {
    case "heat_check":
      return `EVENT heat_check (simulate=${event.simulate}). Call check_heat_alert with simulate=${event.simulate}. If it reports an active heat warning, call score_residents, then plan_checkins, then send_checkin_requests. If no heat warning is active, stop and say you'll keep watching.`;
    case "inbox":
      return "EVENT volunteer_reports. Call read_volunteer_inbox once. Then call record_note_outcome once for EACH note it returns, using that note's noteId. If any record_note_outcome result says ESCALATION REQUIRED, call escalate_to_coordinator for that resident.";
    case "decision": {
      const d = world.decisions.find((x) => x.id === event.decisionId);
      const r = d ? RESIDENT_BY_ID[d.residentId] : undefined;
      const toolName = event.optionId === "welfare_check" ? "request_welfare_check" : "dispatch_second_visit";
      return `EVENT coordinator_decision. The coordinator approved "${d?.options.find((o) => o.id === event.optionId)?.label}" for ${r?.name} (residentId ${r?.id}).
Step 1: call ${toolName} with residentId ${r?.id}. Do this first.
Step 2: only after step 1 succeeds, call read_volunteer_inbox once.
Step 3: call record_note_outcome for each note it returns.`;
    }
  }
}

// Only accept known residents and plain fields from the client-held world.
function sanitize(input: World): World {
  const w = initialWorld();
  if (!input || typeof input !== "object") return w;
  w.clock = Number.isFinite(input.clock) ? input.clock : w.clock;
  w.round = Number.isFinite(input.round) ? input.round : 0;
  w.scored = !!input.scored;
  w.alert = input.alert;
  for (const r of RESIDENTS) if (input.residents?.[r.id]) w.residents[r.id] = { ...w.residents[r.id], ...input.residents[r.id] };
  for (const v of VOLUNTEERS) if (Array.isArray(input.routes?.[v.id])) w.routes[v.id] = input.routes[v.id].filter((id) => RESIDENT_BY_ID[id]);
  w.pendingNotes = Array.isArray(input.pendingNotes) ? input.pendingNotes.filter((n) => RESIDENT_BY_ID[n.residentId]) : [];
  w.decisions = Array.isArray(input.decisions) ? input.decisions.filter((d) => RESIDENT_BY_ID[d.residentId]) : [];
  return w;
}

function cleanText(s: string) {
  return s
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/\*\*/g, "")
    .replace(/\s*\((?:residentId\s*)?r\d{2}\)/g, "")
    .trim();
}

type Verdict = { ok: boolean; rule: string; detail: string } | null;

export async function runPorchlight(event: AgentEvent, input: World, send: (m: StreamMsg) => void) {
  const started = Date.now();
  const world = sanitize(input);
  const run = { toolCalls: 0, inboxRead: false };
  const push = () => send({ type: "state", world: structuredClone(world) });
  const result = (name: string, summary: string, data: unknown) => {
    push();
    send({ type: "tool_result", name, summary });
    return JSON.stringify(data);
  };

  if (event.type === "decision") {
    const d = world.decisions.find((x) => x.id === event.decisionId);
    if (!d || d.resolved) throw new Error("Unknown or already resolved decision");
    d.resolved = event.optionId;
    push();
  }

  const checkHeatAlert = tool({
    name: "check_heat_alert",
    description: "Check live National Weather Service alerts and the hourly forecast for Maryvale, Phoenix. If simulate=true and no live heat alert is active, a clearly labeled simulated Extreme Heat Warning is used for the drill.",
    inputSchema: z.object({ simulate: z.boolean().describe("Use a labeled simulated warning when no live heat alert exists") }),
    callback: async ({ simulate }) => {
      const live = await fetchNws();
      const heat = live.alerts.find((a) => /heat/i.test(a.event));
      if (heat) world.alert = { event: heat.event, headline: heat.headline, source: "nws-live", tempF: live.tempF };
      else if (simulate)
        world.alert = {
          event: "Extreme Heat Warning",
          headline: "SIMULATED drill: Extreme Heat Warning in effect until 8 PM MST. Highs 112 to 116°F; overnight lows near 90.",
          source: "simulated",
          tempF: 115,
        };
      else world.alert = undefined;
      const liveText = `live NWS: ${live.ok ? `${live.alerts.length} active alert(s)${live.tempF != null ? `, ${live.tempF}°F ${live.shortForecast ?? ""}` : ""}` : `unavailable (${live.error})`}`;
      return result("check_heat_alert", world.alert ? `${world.alert.event} (${world.alert.source === "simulated" ? "simulated drill" : "live"}); ${liveText}` : `No heat alert; ${liveText}`, {
        liveNws: { ok: live.ok, activeAlerts: live.alerts.map((a) => a.event), temperatureF: live.tempF, forecast: live.shortForecast },
        heatWarningActive: !!world.alert,
        alert: world.alert ?? null,
      });
    },
  });

  const scoreResidents = tool({
    name: "score_residents",
    description: "Score every enrolled resident's heat risk with the group's fixed rules (age, living alone, AC status, heat-sensitive medications, mobility, top-floor unit).",
    inputSchema: z.object({}),
    callback: () => {
      for (const r of RESIDENTS) Object.assign(world.residents[r.id], scoreResident(r));
      world.scored = true;
      const by = (k: string) => RESIDENTS.filter((r) => world.residents[r.id].risk === k);
      const high = by("high");
      return result("score_residents", `${high.length} high · ${by("elevated").length} elevated · ${by("low").length} low risk`, {
        high: high.map((r) => ({ name: r.name, score: world.residents[r.id].score, factors: world.residents[r.id].factors })),
        elevated: by("elevated").length,
        low: by("low").length,
      });
    },
  });

  const planCheckins = tool({
    name: "plan_checkins",
    description: "Assign every resident to a volunteer: highest risk first, nearest volunteer with capacity, routes visit high-risk homes first.",
    inputSchema: z.object({}),
    callback: () => {
      world.routes = planRoutes(world);
      for (const [vid, stops] of Object.entries(world.routes)) for (const id of stops) world.residents[id].volunteerId = vid;
      const plan = Object.entries(world.routes).map(([vid, stops]) => ({ volunteer: VOLUNTEER_BY_ID[vid].name, stops: stops.length, miles: routeMiles(world, vid), firstStop: RESIDENT_BY_ID[stops[0]].name }));
      return result("plan_checkins", `${plan.length} volunteers · ${RESIDENTS.length} visits · ${plan.reduce((a, p) => a + p.miles, 0).toFixed(1)} mi total`, { plan });
    },
  });

  const sendCheckinRequests = tool({
    name: "send_checkin_requests",
    description: "Text each assigned volunteer their route and text each resident that a neighbor is coming by. Enforces the per-resident message limit.",
    inputSchema: z.object({}),
    callback: () => {
      let sent = 0;
      let skipped = 0;
      for (const r of RESIDENTS) {
        const s = world.residents[r.id];
        if (!s.volunteerId || s.status !== "idle") continue;
        if (messagesLastHour(world, r.id) >= MAX_MESSAGES_PER_HOUR) {
          skipped++;
          continue;
        }
        s.messages.push(world.clock);
        s.status = "contacted";
        sent++;
      }
      return result("send_checkin_requests", `${sent} residents + ${Object.keys(world.routes).length} volunteers texted (simulated SMS)${skipped ? ` · ${skipped} held by rate limit` : ""}`, {
        residentsTexted: sent,
        volunteersTexted: Object.keys(world.routes).length,
        heldByRateLimit: skipped,
      });
    },
  });

  const readInbox = tool({
    name: "read_volunteer_inbox",
    description: "Read new volunteer check-in reports. Quick 'OK' taps are recorded automatically; free-text notes are returned for you to classify.",
    inputSchema: z.object({}),
    callback: () => {
      run.inboxRead = true;
      const next = world.round + 1;
      const spec = ROUNDS[next];
      const unlocked = spec && (next < 3 || world.decisions.some((d) => d.resolved && world.residents[d.residentId].status === "dispatched"));
      if (!unlocked) return result("read_volunteer_inbox", "No new reports", { newReports: 0, notes: [] });
      world.round = next;
      world.clock += spec.minutes;
      let quick = 0;
      for (const [vid, stops] of Object.entries(world.routes)) {
        stops.slice(spec.quickStops[0], spec.quickStops[1]).forEach((id) => {
          const s = world.residents[id];
          if (NOTE_RESIDENTS.has(id) || s.status !== "contacted") return;
          s.status = "ok";
          s.outcome = `${VOLUNTEER_BY_ID[vid].name.split(" ")[0]} checked in: OK`;
          quick++;
        });
      }
      const notes = spec.notes.map((n) => noteFor(n, world));
      world.pendingNotes.push(...notes);
      return result("read_volunteer_inbox", `${fmtClock(world.clock)} · ${quick} quick "OK" check-ins recorded · ${notes.length} ${notes.length === 1 ? "note" : "notes"} to read`, {
        simTime: fmtClock(world.clock),
        quickOkRecorded: quick,
        reachedSoFar: `${reachedCount(world)} of ${RESIDENTS.length}`,
        notes: notes.map((n) => ({ noteId: n.id, from: n.from, resident: RESIDENT_BY_ID[n.residentId].name, text: n.text })),
      });
    },
  });

  const recordNote = tool({
    name: "record_note_outcome",
    description: "Record your classification of one volunteer note. Porchlight applies the follow-up rules automatically (cooling ride, retry visit, escalation requirement).",
    inputSchema: z.object({
      noteId: z.string().describe("noteId from read_volunteer_inbox"),
      outcome: z.enum(["ok", "needs_cooling", "no_answer", "emergency_handled"]),
      summary: z.string().describe("One short sentence summarizing the note"),
    }),
    callback: ({ noteId, outcome, summary }) => {
      const idx = world.pendingNotes.findIndex((n) => n.id === noteId);
      if (idx < 0) return result("record_note_outcome", `Unknown note ${noteId}`, { error: `No pending note ${noteId}` });
      const note = world.pendingNotes.splice(idx, 1)[0];
      const r = RESIDENT_BY_ID[note.residentId];
      const s = world.residents[r.id];
      let followUp = "";
      if (outcome === "ok") {
        s.status = "ok";
        s.outcome = summary;
        followUp = "Marked reached.";
      } else if (outcome === "needs_cooling") {
        const { center, miles: mi } = nearestCooling(r);
        s.status = "cooling";
        s.outcome = `Ride to ${center.name} (${mi} mi) with ${note.from.split(" ")[0]}`;
        followUp = `Marked reached. Ride booked to ${center.name}, ${mi} mi away.`;
      } else if (outcome === "no_answer") {
        s.attempts += 1;
        if (s.attempts < 2) {
          s.status = "retry";
          s.outcome = "No answer. Retry visit scheduled";
          followUp = `Unanswered visit ${s.attempts} of 2. A retry visit is scheduled automatically; escalation is not allowed yet.`;
        } else {
          s.status = "no_answer";
          s.outcome = `${s.attempts} unanswered visits`;
          followUp = `ESCALATION REQUIRED: ${r.name} (residentId ${r.id}) is ${s.risk} risk with ${s.attempts} unanswered visits. Call escalate_to_coordinator.`;
        }
      } else {
        s.status = "safe";
        s.outcome = summary;
        followUp = "Marked reached. Emergency services have taken over; coordinator notified.";
      }
      return result("record_note_outcome", `${r.name}: ${outcome.replace("_", " ")}${outcome === "no_answer" ? ` (visit ${s.attempts} of 2)` : ""}`, {
        resident: r.name,
        outcome,
        followUp,
        reached: `${reachedCount(world)} of ${RESIDENTS.length}`,
      });
    },
  });

  const escalate = tool({
    name: "escalate_to_coordinator",
    description: "Send the human coordinator a decision card for a resident who could not be reached. Only allowed after two unanswered visits.",
    inputSchema: z.object({ residentId: z.string(), reason: z.string().describe("One plain sentence (max 25 words) the coordinator can act on") }),
    callback: ({ residentId, reason }) => {
      const r = RESIDENT_BY_ID[residentId];
      const s = world.residents[residentId];
      const helper = VOLUNTEERS.filter((v) => v.id !== s.volunteerId).sort((a, b) => miles(r, a) - miles(r, b))[0];
      const decision: Decision = {
        id: `d-${residentId}`,
        residentId,
        reason: cleanText(reason),
        facts: [...(s.factors ?? []), `${s.attempts} unanswered visits`, "newspapers uncollected"],
        options: [
          { id: "welfare_check", label: "Request police welfare check" },
          { id: "second_visit", label: `Send ${helper.name.split(" ")[0]} to go in with the neighbor's key` },
        ],
      };
      s.status = "escalated";
      world.decisions.push(decision);
      return result("escalate_to_coordinator", `Decision card sent: ${r.name}`, { sent: true, waitingForCoordinator: true });
    },
  });

  const requestWelfareCheck = tool({
    name: "request_welfare_check",
    description: "Request a police welfare check for a resident (simulated call to the non-emergency line). Requires the coordinator's approval.",
    inputSchema: z.object({ residentId: z.string() }),
    callback: ({ residentId }) => {
      const s = world.residents[residentId];
      s.status = "dispatched";
      s.outcome = "Welfare check requested (police non-emergency line, simulated)";
      return result("request_welfare_check", `Welfare check requested for ${RESIDENT_BY_ID[residentId].name}`, { requested: true, volunteerStaysOnScene: VOLUNTEER_BY_ID[s.volunteerId ?? ""]?.name });
    },
  });

  const dispatchSecondVisit = tool({
    name: "dispatch_second_visit",
    description: "Send the nearest other volunteer to enter with the neighbor's spare key. Requires the coordinator's approval.",
    inputSchema: z.object({ residentId: z.string() }),
    callback: ({ residentId }) => {
      const r = RESIDENT_BY_ID[residentId];
      const s = world.residents[residentId];
      const helper = VOLUNTEERS.filter((v) => v.id !== s.volunteerId).sort((a, b) => miles(r, a) - miles(r, b))[0];
      s.status = "dispatched";
      s.helperId = helper.id;
      s.outcome = `${helper.name} dispatched (${(miles(r, helper) * 3).toFixed(0)} min away)`;
      return result("dispatch_second_visit", `${helper.name} dispatched to ${r.name}`, { dispatched: helper.name, miles: Math.round(miles(r, helper) * 10) / 10 });
    },
  });

  const model = new OpenAIModel({
    api: "chat",
    apiKey: process.env.OPENAI_API_KEY,
    modelId: process.env.OPENAI_MODEL,
    temperature: 0,
    clientConfig: { baseURL: process.env.OPENAI_BASE_URL, timeout: 60_000, maxRetries: 2 },
  });

  const agent = new Agent({
    model,
    systemPrompt: SYSTEM_PROMPT,
    printer: false,
    tools: [checkHeatAlert, scoreResidents, planCheckins, sendCheckinRequests, readInbox, recordNote, escalate, requestWelfareCheck, dispatchSecondVisit],
  });

  // Deterministic guardrails, checked before every tool call whatever the model decided.
  const check = (name: string, args: Record<string, unknown>): Verdict => {
    if (run.toolCalls > MAX_TOOL_CALLS) return { ok: false, rule: "step cap", detail: `At most ${MAX_TOOL_CALLS} tool calls per run.` };

    if (["score_residents", "plan_checkins", "send_checkin_requests"].includes(name)) {
      if (!world.alert) return { ok: false, rule: "heat warning required", detail: "No active heat warning. Porchlight never mass-contacts residents without one." };
      if (name === "plan_checkins" && !world.scored) return { ok: false, rule: "score before assigning", detail: "Residents must be risk-scored before volunteers are assigned." };
      if (name === "send_checkin_requests") {
        if (!Object.keys(world.routes).length) return { ok: false, rule: "plan before messaging", detail: "No volunteer routes exist yet." };
        return { ok: true, rule: "message rate limit", detail: `Max ${MAX_MESSAGES_PER_HOUR} automated texts per resident per hour` };
      }
      return { ok: true, rule: "heat warning required", detail: `${world.alert.event} (${world.alert.source === "simulated" ? "simulated drill" : "live NWS"})` };
    }

    if (name === "read_volunteer_inbox") {
      if (run.inboxRead) return { ok: false, rule: "one inbox read per run", detail: "Reports were already read in this run." };
      const pending = world.decisions.find((d) => d.resolved && world.residents[d.residentId].status === "escalated");
      if (pending) {
        const toolName = pending.resolved === "welfare_check" ? "request_welfare_check" : "dispatch_second_visit";
        return { ok: false, rule: "act on approval first", detail: `The coordinator approved an action for ${RESIDENT_BY_ID[pending.residentId].name}. Call ${toolName} with residentId ${pending.residentId} before reading reports.` };
      }
      return null;
    }

    if (name === "escalate_to_coordinator") {
      const id = String(args.residentId ?? "");
      const s = world.residents[id];
      const r = RESIDENT_BY_ID[id];
      if (!s || !r) return { ok: false, rule: "known resident", detail: `No enrolled resident with id ${id}.` };
      if (world.decisions.some((d) => d.residentId === id && !d.resolved)) return { ok: false, rule: "no duplicate escalations", detail: `${r.name} already has an open decision card.` };
      if (s.status !== "no_answer" || s.attempts < 2)
        return { ok: false, rule: "two unanswered visits", detail: `${r.name} has ${s.attempts} unanswered visit(s). A volunteer retries before the coordinator is interrupted.` };
      return { ok: true, rule: "two unanswered visits", detail: `${r.name}: ${s.attempts} unanswered in-person visits, ${s.risk} risk` };
    }

    if (name === "request_welfare_check" || name === "dispatch_second_visit") {
      const id = String(args.residentId ?? "");
      const option = name === "request_welfare_check" ? "welfare_check" : "second_visit";
      const d = world.decisions.find((x) => x.residentId === id && x.resolved === option);
      if (!d) return { ok: false, rule: "coordinator approval", detail: "Only the human coordinator can authorize this action, and they have not." };
      if (world.residents[id].status !== "escalated") return { ok: false, rule: "coordinator approval", detail: "This approved action was already carried out." };
      return { ok: true, rule: "coordinator approval", detail: `Approved by coordinator: ${d.options.find((o) => o.id === option)?.label}` };
    }
    return null;
  };

  agent.addHook(BeforeToolCallEvent, (e) => {
    const name = e.toolUse.name;
    const args = (e.toolUse.input ?? {}) as Record<string, unknown>;
    run.toolCalls++;
    const verdict = check(name, args);
    if (verdict?.ok) send({ type: "guardrail", ...verdict, tool: name });
    send({ type: "tool_call", id: e.toolUse.toolUseId, name, input: args });
    if (verdict && !verdict.ok) {
      e.cancel = `Blocked by Porchlight guardrail "${verdict.rule}": ${verdict.detail}`;
      send({ type: "guardrail", ...verdict, tool: name });
    }
  });

  const out = await agent.invoke(promptFor(event, world));
  send({ type: "text", text: cleanText(String(out)) });
  push();
  send({ type: "done", ms: Date.now() - started, toolCalls: run.toolCalls });
}
