// Live National Weather Service data (api.weather.gov, no key; a User-Agent is required).
export const POINT = { lat: 33.4942, lng: -112.1857, label: "Maryvale, Phoenix AZ" };
const UA = "Porchlight heat-check agent (github.com/chinesepowered/porchlight)";

export interface NwsLive {
  ok: boolean;
  place: string;
  fetchedAt: string;
  alerts: { event: string; headline: string }[];
  tempF?: number;
  shortForecast?: string;
  error?: string;
}

async function getJson(url: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/geo+json" },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`NWS ${res.status} for ${new URL(url).pathname}`);
  return res.json();
}

export async function fetchNws(): Promise<NwsLive> {
  const base = { place: POINT.label, fetchedAt: new Date().toISOString() };
  try {
    const [alerts, point] = await Promise.all([
      getJson(`https://api.weather.gov/alerts/active?point=${POINT.lat},${POINT.lng}`),
      getJson(`https://api.weather.gov/points/${POINT.lat},${POINT.lng}`),
    ]);
    let tempF: number | undefined;
    let shortForecast: string | undefined;
    try {
      const hourly = await getJson(point.properties.forecastHourly);
      const now = hourly.properties.periods[0];
      const t = typeof now.temperature === "number" ? now.temperature : now.temperature?.value;
      tempF = now.temperatureUnit === "C" ? Math.round((t * 9) / 5 + 32) : t;
      shortForecast = now.shortForecast;
    } catch {
      // forecast is optional; alerts are what matter
    }
    return {
      ok: true,
      ...base,
      alerts: (alerts.features ?? []).map((f: { properties: { event: string; headline: string } }) => ({
        event: f.properties.event,
        headline: f.properties.headline,
      })),
      tempF,
      shortForecast,
    };
  } catch (e) {
    return { ok: false, ...base, alerts: [], error: e instanceof Error ? e.message : String(e) };
  }
}
