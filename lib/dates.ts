export function todayIn(zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function daysAfter(day: string, count = 30) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}

export function formatTimestamp(value: string, zone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: "h23",
  }).format(new Date(value));
}
