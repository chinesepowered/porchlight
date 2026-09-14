export type Risk = "high" | "elevated" | "low";

export type Status =
  | "idle" // not yet contacted
  | "contacted" // volunteer visit requested
  | "retry" // one unanswered visit, retry scheduled
  | "no_answer" // two unanswered visits
  | "escalated" // decision card sent to the coordinator
  | "dispatched" // coordinator-approved follow-up on the way
  | "ok" // reached, fine
  | "cooling" // reached, ride to a cooling station arranged
  | "safe"; // reached after an emergency response

export interface Resident {
  id: string;
  name: string;
  age: number;
  street: string;
  lat: number;
  lng: number;
  livesAlone: boolean;
  ac: "none" | "broken" | "working";
  heatMeds: string[];
  limitedMobility: boolean;
  topFloor: boolean;
}

export interface Volunteer {
  id: string;
  name: string;
  initials: string;
  lat: number;
  lng: number;
  capacity: number;
  color: string;
}

export interface CoolingCenter {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface ResidentState {
  status: Status;
  risk?: Risk;
  score?: number;
  factors?: string[];
  volunteerId?: string;
  helperId?: string;
  attempts: number;
  messages: number[]; // sim-clock minutes when automated messages were sent
  outcome?: string;
}

export interface Note {
  id: string;
  residentId: string;
  from: string;
  text: string;
}

export interface DecisionOption {
  id: "welfare_check" | "second_visit";
  label: string;
}

export interface Decision {
  id: string;
  residentId: string;
  reason: string;
  facts: string[];
  options: DecisionOption[];
  resolved?: DecisionOption["id"];
}

export interface HeatAlert {
  event: string;
  headline: string;
  source: "nws-live" | "simulated";
  tempF?: number;
}

export interface World {
  clock: number; // minutes since midnight, simulated
  round: number; // volunteer report rounds delivered
  alert?: HeatAlert;
  scored: boolean;
  residents: Record<string, ResidentState>;
  routes: Record<string, string[]>; // volunteerId -> ordered resident ids
  pendingNotes: Note[];
  decisions: Decision[];
}

export type AgentEvent =
  | { type: "heat_check"; simulate: boolean }
  | { type: "inbox" }
  | { type: "decision"; decisionId: string; optionId: DecisionOption["id"] };

export type StreamMsg =
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; name: string; summary: string }
  | { type: "guardrail"; ok: boolean; rule: string; detail: string; tool: string }
  | { type: "state"; world: World }
  | { type: "text"; text: string }
  | { type: "error"; message: string }
  | { type: "done"; ms: number; toolCalls: number };
