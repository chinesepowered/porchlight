// Fictional residents, volunteers, and volunteer reports for the demo.
// Locations are randomized points inside Maryvale, Phoenix AZ; no real people or addresses.
import type { CoolingCenter, Note, Resident, Volunteer, World } from "./types";

type Raw = [id: string, name: string, age: number, alone: boolean, ac: Resident["ac"], meds: string[], mobility: boolean, topFloor: boolean];

const RAW: Raw[] = [
  ["r01", "Dolores Ruiz", 84, true, "broken", ["furosemide (diuretic)"], true, false],
  ["r02", "Samuel Okafor", 81, true, "none", ["metoprolol (beta-blocker)"], false, false],
  ["r03", "Earl Whitaker", 69, true, "working", [], false, false],
  ["r04", "Mei Chen", 88, false, "working", ["oxybutynin (anticholinergic)"], true, false],
  ["r05", "Guadalupe Hernández", 77, true, "working", ["HCTZ (diuretic)"], false, false],
  ["r06", "Frank Delgado", 72, false, "broken", [], false, false],
  ["r07", "Ruth Abernathy", 91, true, "working", [], true, false],
  ["r08", "José Morales", 66, false, "working", [], false, false],
  ["r09", "Bernice Walker", 79, true, "none", [], false, true],
  ["r10", "Minh Tran", 74, false, "working", ["metoprolol (beta-blocker)"], false, false],
  ["r11", "Carmen Villa", 83, true, "working", [], false, false],
  ["r12", "Harold Jensen", 86, true, "broken", ["quetiapine (antipsychotic)"], false, false],
  ["r13", "Esperanza Lucero", 70, false, "none", [], false, false],
  ["r14", "Walter Brooks", 68, false, "working", [], false, false],
  ["r15", "Ana Castillo", 75, true, "working", [], false, false],
  ["r16", "Leonard Price", 80, false, "working", ["furosemide (diuretic)"], false, false],
  ["r17", "Rosa Ibarra", 67, true, "working", [], false, false],
  ["r18", "Gloria Nwosu", 73, true, "broken", [], false, true],
  ["r19", "Raymond Chavez", 78, false, "working", [], true, false],
  ["r20", "Irene Kowalski", 85, true, "working", ["oxybutynin (anticholinergic)"], false, false],
  ["r21", "Manuel Ortega", 71, false, "working", [], false, false],
  ["r22", "Joyce Bennett", 82, false, "none", [], false, false],
  ["r23", "Alfredo Soto", 76, true, "working", [], false, false],
  ["r24", "Patricia Lee", 69, false, "working", ["HCTZ (diuretic)"], false, false],
  ["r25", "Hector Ramírez", 88, true, "working", [], true, true],
  ["r26", "Nora Fitzgerald", 65, true, "working", [], false, false],
  ["r27", "Benito Aguilar", 80, false, "broken", [], false, false],
  ["r28", "Shirley Adams", 74, true, "working", ["metoprolol (beta-blocker)"], false, false],
  ["r29", "Luz María Peña", 90, false, "working", [], true, false],
  ["r30", "Curtis Hall", 67, false, "working", [], false, false],
  ["r31", "Teresa Salinas", 79, true, "none", ["quetiapine (antipsychotic)"], false, false],
  ["r32", "George Yamamoto", 83, false, "working", [], false, false],
  ["r33", "Imelda Garza", 72, true, "working", [], false, true],
  ["r34", "Vernon Lewis", 76, false, "working", [], false, false],
];

export const VOLUNTEERS: Volunteer[] = [
  { id: "v1", name: "Maya Torres", initials: "MT", lat: 33.4936, lng: -112.1842, capacity: 6, color: "#ffb347" },
  { id: "v2", name: "Jordan Lee", initials: "JL", lat: 33.4992, lng: -112.1738, capacity: 6, color: "#7cc6fe" },
  { id: "v3", name: "Priya Nair", initials: "PN", lat: 33.4846, lng: -112.1762, capacity: 6, color: "#c9a0ff" },
  { id: "v4", name: "Luis García", initials: "LG", lat: 33.4818, lng: -112.1992, capacity: 6, color: "#6fd3a0" },
  { id: "v5", name: "Grace Kim", initials: "GK", lat: 33.5012, lng: -112.1968, capacity: 6, color: "#ff8fab" },
  { id: "v6", name: "Tom Becker", initials: "TB", lat: 33.4882, lng: -112.2022, capacity: 6, color: "#f7d154" },
  { id: "v7", name: "Aisha Mohammed", initials: "AM", lat: 33.4962, lng: -112.1928, capacity: 6, color: "#5fd0e6" },
];

export const COOLING: CoolingCenter[] = [
  { id: "c1", name: "Westside Community Cooling Center", lat: 33.4952, lng: -112.1702 },
  { id: "c2", name: "Palm Lane Library Cooling Room", lat: 33.4826, lng: -112.1888 },
];

const FIXED: Record<string, [number, number]> = {
  r01: [33.4902, -112.1878],
  r17: [33.4909, -112.1896], // Rosa lives next door to Dolores
  r02: [33.4979, -112.1776],
  r03: [33.4834, -112.1962],
  r04: [33.5003, -112.1992],
};

const STREETS: [number, string][] = [
  [33.48, "W Thomas Rd"],
  [33.4836, "W Earll Dr"],
  [33.4873, "W Osborn Rd"],
  [33.4909, "W Clarendon Ave"],
  [33.4945, "W Indian School Rd"],
  [33.4981, "W Montecito Ave"],
  [33.5017, "W Campbell Ave"],
];

function streetFor(lat: number, lng: number) {
  const s = STREETS.reduce((a, b) => (Math.abs(b[0] - lat) < Math.abs(a[0] - lat) ? b : a));
  const block = Math.floor(((-112.074 - lng) * 52820) / 100) * 100;
  return `${block} block ${s[1]}`;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function place(): Resident[] {
  const rand = mulberry32(20260914);
  const taken: [number, number][] = [
    ...VOLUNTEERS.map((v) => [v.lat, v.lng] as [number, number]),
    ...COOLING.map((c) => [c.lat, c.lng] as [number, number]),
    ...Object.values(FIXED),
  ];
  return RAW.map(([id, name, age, livesAlone, ac, heatMeds, limitedMobility, topFloor]) => {
    let pos = FIXED[id];
    if (!pos) {
      for (let i = 0; i < 500; i++) {
        const cand: [number, number] = [33.4798 + rand() * 0.0228, -112.2032 + rand() * 0.0345];
        if (taken.every(([la, ln]) => Math.hypot(la - cand[0], (ln - cand[1]) * 0.83) > 0.0021) || i === 499) {
          pos = cand;
          break;
        }
      }
      taken.push(pos);
    }
    return { id, name, age, livesAlone, ac, heatMeds, limitedMobility, topFloor, lat: pos[0], lng: pos[1], street: streetFor(pos[0], pos[1]) };
  });
}

export const RESIDENTS: Resident[] = place();
export const RESIDENT_BY_ID: Record<string, Resident> = Object.fromEntries(RESIDENTS.map((r) => [r.id, r]));
export const VOLUNTEER_BY_ID: Record<string, Volunteer> = Object.fromEntries(VOLUNTEERS.map((v) => [v.id, v]));

export const START_CLOCK = 12 * 60 + 40;

export function initialWorld(): World {
  return {
    clock: START_CLOCK,
    round: 0,
    scored: false,
    residents: Object.fromEntries(RESIDENTS.map((r) => [r.id, { status: "idle", attempts: 0, messages: [] }])),
    routes: {},
    pendingNotes: [],
    decisions: [],
  };
}

// Residents whose reports arrive as free-text notes (the agent classifies these); everyone else taps "OK".
export const NOTE_RESIDENTS = new Set(["r01", "r02", "r03", "r04"]);

type NoteSpec = { id: string; residentId: string; text: (ctx: { helper?: string; option?: string }) => string };

export const ROUNDS: Record<number, { minutes: number; quickStops: [number, number]; notes: NoteSpec[] }> = {
  1: {
    minutes: 35,
    quickStops: [0, 3],
    notes: [
      {
        id: "n1",
        residentId: "r02",
        text: () =>
          "At Samuel Okafor's now. His AC unit is dead and it's 96 degrees inside. He's sweating a lot but talking fine. He said he'd go somewhere cool if someone drives him.",
      },
      {
        id: "n2",
        residentId: "r01",
        text: () => "Knocked at Dolores Ruiz's three times and rang the bell. No answer. Her car is in the carport and the blinds are shut.",
      },
      { id: "n3", residentId: "r04", text: () => "Mrs. Chen is fine. Her daughter is staying with her this week and the AC is set to 76." },
      { id: "n4", residentId: "r03", text: () => "Called Earl Whitaker twice, straight to voicemail. Nobody came to the door either. I'll try again after my other stops." },
    ],
  },
  2: {
    minutes: 40,
    quickStops: [3, 99],
    notes: [
      {
        id: "n5",
        residentId: "r01",
        text: () =>
          "Back at Dolores's with her neighbor Rosa. Still no answer. Yesterday's and today's newspapers are on the step and the door is locked. Rosa has a spare key but doesn't want to go in alone.",
      },
      { id: "n6", residentId: "r03", text: () => "Earl called me back. He was napping with the swamp cooler on. He's fine and drinking water." },
    ],
  },
  3: {
    minutes: 25,
    quickStops: [0, 0],
    notes: [
      {
        id: "n7",
        residentId: "r01",
        text: ({ option, helper }) =>
          option === "welfare_check"
            ? "The officer got here in 12 minutes and went in with Rosa's spare key. Dolores was on the kitchen floor, conscious but confused and very hot. EMS is taking her to the hospital. The paramedic said it matters that we got to her today."
            : `${helper ?? "The second volunteer"} and I went in with Rosa's key. Dolores was on the kitchen floor, conscious but confused and very hot. We called 911 and cooled her with wet towels. EMS is taking her to the hospital. The paramedic said it matters that we got to her today.`,
      },
    ],
  },
};

export function noteFor(spec: NoteSpec, world: World): Note {
  const rs = world.residents[spec.residentId];
  const decision = world.decisions.find((d) => d.residentId === spec.residentId && d.resolved);
  const helper = rs.helperId ? VOLUNTEER_BY_ID[rs.helperId]?.name.split(" ")[0] : undefined;
  return {
    id: spec.id,
    residentId: spec.residentId,
    from: VOLUNTEER_BY_ID[rs.volunteerId ?? ""]?.name ?? "Volunteer",
    text: spec.text({ helper, option: decision?.resolved }),
  };
}
