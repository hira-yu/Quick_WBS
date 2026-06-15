import type { TaskNode, TaskStatus } from "./types";

export type GanttItem = {
  id: string;
  title: string;
  wbsNumber: string;
  depth: number;
  status: TaskStatus;
  progress: number;
  start: Date;
  end: Date;
  dueDate: Date | null;
  color: string;
  rootTaskId: string;
  isAutoScheduled: boolean;
};

export type GanttSchedule = {
  items: GanttItem[];
  start: Date;
  end: Date;
  days: Date[];
  fallbackEnd: Date;
};

const dayMs = 24 * 60 * 60 * 1000;

export function buildGanttSchedule(nodes: TaskNode[], projectCreatedAt: string | Date | null = new Date()): GanttSchedule | null {
  const projectStart = parseDateLike(projectCreatedAt) ?? startOfDay(new Date());
  const cursor = startOfDay(projectStart);
  const items = scheduleNodes(nodes, cursor).items;
  if (items.length === 0) return null;

  const start = projectStart;
  const latestTaskEnd = new Date(Math.max(...items.map((item) => item.end.getTime())));
  const fallbackEnd = addMonths(new Date(), 2);
  const end = maxDate([latestTaskEnd, fallbackEnd]);

  return {
    items,
    start,
    end,
    fallbackEnd,
    days: enumerateDays(start, end),
  };
}

function scheduleNodes(nodes: TaskNode[], cursor: Date, rootTask?: TaskNode): { items: GanttItem[]; nextCursor: Date } {
  const items: GanttItem[] = [];
  let nextCursor = new Date(cursor);

  for (const node of nodes) {
    const scheduled = scheduleNode(node, nextCursor, rootTask ?? node);
    items.push(scheduled.item);
    items.push(...scheduled.children);
    nextCursor = addDays(scheduled.item.end, 1);
  }

  return { items, nextCursor };
}

function scheduleNode(node: TaskNode, cursor: Date, rootTask: TaskNode): { item: GanttItem; children: GanttItem[] } {
  const ownStart = parseDate(node.start_date);
  const ownEnd = parseDate(node.due_date);
  const autoDuration = estimateDurationDays(node.estimate_hours);
  const autoStart = new Date(cursor);
  const autoEnd = addDays(autoStart, autoDuration - 1);

  let children: GanttItem[] = [];
  if (node.children.length > 0) {
    const childSchedule = scheduleNodes(node.children, ownStart ?? autoStart, rootTask);
    children = childSchedule.items;
  }

  const childStart = children.length > 0 ? minDate(children.map((child) => child.start)) : null;
  const childEnd = children.length > 0 ? maxDate(children.map((child) => child.end)) : null;

  const start = ownStart ?? childStart ?? autoStart;
  const end = maxDate([ownEnd, childEnd, autoEnd].filter((date): date is Date => date !== null));

  return {
    item: {
      id: node.id,
      title: node.title,
      wbsNumber: node.wbsNumber,
      depth: node.depth,
      status: node.status,
      progress: node.progress,
      start,
      end,
      dueDate: ownEnd,
      color: rootTask.gantt_color ?? fallbackColor(rootTask.id),
      rootTaskId: rootTask.id,
      isAutoScheduled: !ownStart || !ownEnd,
    },
    children,
  };
}

export function daysBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / dayMs));
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return startOfDay(next);
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return startOfDay(next);
}

export function formatDateLabel(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

export function getDateTone(date: Date): "weekday" | "saturday" | "holiday" {
  const day = startOfDay(date).getDay();
  if (day === 0 || getJapaneseHolidayName(date)) return "holiday";
  if (day === 6) return "saturday";
  return "weekday";
}

export function getJapaneseHolidayName(date: Date): string | null {
  const target = toDateInputValue(date);
  const holidays = getJapaneseHolidays(date.getFullYear());
  return holidays.get(target) ?? null;
}

export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function estimateDurationDays(estimateHours: string | null): number {
  const hours = Number(estimateHours ?? 0);
  if (!Number.isFinite(hours) || hours <= 0) return 1;

  return Math.max(1, Math.ceil(hours / 8));
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : startOfDay(parsed);
}

function parseDateLike(value: string | Date | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return startOfDay(value);

  const normalized = value.includes(" ") ? value.replace(" ", "T") : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : startOfDay(parsed);
}

function enumerateDays(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  for (let date = startOfDay(start); date <= end; date = addDays(date, 1)) {
    days.push(date);
  }

  return days;
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function minDate(dates: Date[]): Date | null {
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}

function maxDate(dates: Date[]): Date {
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function isSameDay(left: Date, right: Date): boolean {
  return toDateInputValue(left) === toDateInputValue(right);
}

function fallbackColor(seed: string): string {
  const palette = ["#2563eb", "#0891b2", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#be185d", "#4f46e5"];
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  return palette[hash % palette.length];
}

function getJapaneseHolidays(year: number): Map<string, string> {
  const holidays = new Map<string, string>();
  const add = (month: number, day: number, name: string) => {
    holidays.set(toDateInputValue(new Date(year, month - 1, day)), name);
  };
  const addHappyMonday = (month: number, week: number, name: string) => {
    add(month, nthWeekday(year, month, 1, week), name);
  };

  add(1, 1, "元日");
  addHappyMonday(1, 2, "成人の日");
  add(2, 11, "建国記念の日");
  add(2, 23, "天皇誕生日");
  add(3, springEquinoxDay(year), "春分の日");
  add(4, 29, "昭和の日");
  add(5, 3, "憲法記念日");
  add(5, 4, "みどりの日");
  add(5, 5, "こどもの日");
  addHappyMonday(7, 3, "海の日");
  add(8, 11, "山の日");
  addHappyMonday(9, 3, "敬老の日");
  add(9, autumnEquinoxDay(year), "秋分の日");
  addHappyMonday(10, 2, "スポーツの日");
  add(11, 3, "文化の日");
  add(11, 23, "勤労感謝の日");

  addSubstituteHolidays(holidays);
  addCitizensHolidays(holidays, year);

  return holidays;
}

function nthWeekday(year: number, month: number, weekday: number, week: number): number {
  const first = new Date(year, month - 1, 1).getDay();
  const offset = (weekday - first + 7) % 7;
  return 1 + offset + (week - 1) * 7;
}

function springEquinoxDay(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function autumnEquinoxDay(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function addSubstituteHolidays(holidays: Map<string, string>): void {
  for (const [dateValue] of Array.from(holidays)) {
    const date = parseDate(dateValue);
    if (!date || date.getDay() !== 0) continue;

    let substitute = addDays(date, 1);
    while (holidays.has(toDateInputValue(substitute))) {
      substitute = addDays(substitute, 1);
    }
    holidays.set(toDateInputValue(substitute), "振替休日");
  }
}

function addCitizensHolidays(holidays: Map<string, string>, year: number): void {
  const start = new Date(year, 0, 2);
  const end = new Date(year, 11, 30);
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const value = toDateInputValue(date);
    if (holidays.has(value) || date.getDay() === 0) continue;

    const previous = toDateInputValue(addDays(date, -1));
    const next = toDateInputValue(addDays(date, 1));
    if (holidays.has(previous) && holidays.has(next)) {
      holidays.set(value, "国民の休日");
    }
  }
}
