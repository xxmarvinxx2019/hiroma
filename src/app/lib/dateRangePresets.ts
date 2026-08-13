export type DateRangePreset =
  | "today"
  | "yesterday"
  | "last_7_days"
  | "last_30_days"
  | "this_month"
  | "last_month"
  | "this_year"
  | "all_time"
  | "custom";

const manilaDate = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

export const getManilaToday = () => manilaDate(new Date());

const shiftDate = (date: string, days: number) =>
  manilaDate(
    new Date(new Date(`${date}T00:00:00+08:00`).getTime() + days * 86_400_000),
  );

export function getDateRangePreset(preset: Exclude<DateRangePreset, "custom">) {
  const today = getManilaToday();
  if (preset === "today") return { from: today, to: today };
  if (preset === "yesterday") {
    const yesterday = shiftDate(today, -1);
    return { from: yesterday, to: yesterday };
  }
  if (preset === "last_7_days")
    return { from: shiftDate(today, -6), to: today };
  if (preset === "last_30_days")
    return { from: shiftDate(today, -29), to: today };
  if (preset === "this_month")
    return { from: `${today.slice(0, 8)}01`, to: today };
  if (preset === "last_month") {
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const previousYear = month === 1 ? year - 1 : year;
    const previousMonth = month === 1 ? 12 : month - 1;
    const monthText = String(previousMonth).padStart(2, "0");
    const lastDay = new Date(
      Date.UTC(previousYear, previousMonth, 0),
    ).getUTCDate();
    return {
      from: `${previousYear}-${monthText}-01`,
      to: `${previousYear}-${monthText}-${String(lastDay).padStart(2, "0")}`,
    };
  }
  if (preset === "this_year")
    return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return { from: "1970-01-01", to: today };
}

export const datePresetOptions: Array<{
  value: DateRangePreset;
  label: string;
}> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_year", label: "This year" },
  { value: "all_time", label: "All time" },
  { value: "custom", label: "Custom range" },
];
