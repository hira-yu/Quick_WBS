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
  isAutoScheduled: boolean;
};

export type GanttSchedule = {
  items: GanttItem[];
  start: Date;
  end: Date;
  days: Date[];
};

const dayMs = 24 * 60 * 60 * 1000;

export function buildGanttSchedule(nodes: TaskNode[], baseDate = new Date()): GanttSchedule | null {
  const cursor = startOfDay(baseDate);
  const items = scheduleNodes(nodes, cursor).items;
  if (items.length === 0) return null;

  const start = new Date(Math.min(...items.map((item) => item.start.getTime())));
  const end = new Date(Math.max(...items.map((item) => item.end.getTime())));

  return {
    items,
    start,
    end,
    days: enumerateDays(start, end),
  };
}

function scheduleNodes(nodes: TaskNode[], cursor: Date): { items: GanttItem[]; nextCursor: Date } {
  const items: GanttItem[] = [];
  let nextCursor = new Date(cursor);

  for (const node of nodes) {
    const scheduled = scheduleNode(node, nextCursor);
    items.push(scheduled.item);
    items.push(...scheduled.children);
    nextCursor = addDays(scheduled.item.end, 1);
  }

  return { items, nextCursor };
}

function scheduleNode(node: TaskNode, cursor: Date): { item: GanttItem; children: GanttItem[] } {
  const ownStart = parseDate(node.start_date);
  const ownEnd = parseDate(node.due_date);
  const autoDuration = estimateDurationDays(node.estimate_hours);
  const autoStart = new Date(cursor);
  const autoEnd = addDays(autoStart, autoDuration - 1);

  let children: GanttItem[] = [];
  if (node.children.length > 0) {
    const childSchedule = scheduleNodes(node.children, ownStart ?? autoStart);
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

export function formatDateLabel(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
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

