import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  ListTree,
  Palette,
  Plus,
  RefreshCw,
  StretchHorizontal,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { api } from "./api";
import { buildGanttSchedule, daysBetween, formatDateLabel, getDateTone, getJapaneseHolidayName, isToday } from "./gantt";
import type { AssigneeType, Project, Task, TaskLog, TaskNode, TaskPriority, TaskStatus } from "./types";
import { buildTaskTree, flattenTaskTree, flattenVisibleTaskTree } from "./wbs";

const ganttPalette = ["#2563eb", "#0891b2", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#be185d", "#4f46e5"];

function randomGanttColor(): string {
  return ganttPalette[Math.floor(Math.random() * ganttPalette.length)];
}

const statusLabels: Record<TaskStatus, string> = {
  todo: "未着手",
  ready: "着手可",
  in_progress: "作業中",
  blocked: "停止中",
  review: "レビュー",
  done: "完了",
};

const priorityLabels: Record<TaskPriority, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "緊急",
};

const assigneeTypeLabels: Record<AssigneeType, string> = {
  human: "人間",
  ai: "AI",
};

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [projectName, setProjectName] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [childComposerParentId, setChildComposerParentId] = useState<string>("");
  const [childTitle, setChildTitle] = useState("");
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const tree = useMemo(() => buildTaskTree(tasks), [tasks]);
  const rows = useMemo(() => flattenTaskTree(tree), [tree]);
  const visibleRows = useMemo(() => flattenVisibleTaskTree(tree, collapsedTaskIds), [tree, collapsedTaskIds]);
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const ganttSchedule = useMemo(() => buildGanttSchedule(tree, activeProject?.created_at ?? null), [tree, activeProject?.created_at]);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const parentOptions = useMemo(() => {
    if (!selectedTask) return [];

    const selectedNode = rows.find((task) => task.id === selectedTask.id);
    const excludedIds = new Set<string>([selectedTask.id]);
    if (selectedNode) {
      for (const id of collectDescendantIds(selectedNode)) {
        excludedIds.add(id);
      }
    }

    return rows.filter((task) => !excludedIds.has(task.id));
  }, [rows, selectedTask]);

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    if (activeProjectId) {
      void loadTasks(activeProjectId);
    } else {
      setTasks([]);
      setSelectedTaskId("");
    }
  }, [activeProjectId]);

  useEffect(() => {
    const rootsWithoutColor = tasks.filter((task) => task.parent_id === null && !task.gantt_color);
    if (rootsWithoutColor.length === 0) return;

    const assignments = new Map(rootsWithoutColor.map((task) => [task.id, randomGanttColor()]));
    setTasks((current) =>
      current.map((task) => {
        const ganttColor = assignments.get(task.id);
        return ganttColor ? { ...task, gantt_color: ganttColor } : task;
      }),
    );

    for (const [taskId, ganttColor] of assignments) {
      void api.updateTask(taskId, { gantt_color: ganttColor }).catch(() => {
        setError("ガントチャートの初期色を保存できませんでした。");
      });
    }
  }, [tasks]);

  useEffect(() => {
    if (rows.length > 0 && (!selectedTaskId || !tasks.some((task) => task.id === selectedTaskId))) {
      setSelectedTaskId(rows[0].id);
    }
    if (rows.length === 0) {
      setSelectedTaskId("");
    }
  }, [rows, selectedTaskId, tasks]);

  useEffect(() => {
    if (selectedTask?.id) {
      void reloadLogs(selectedTask.id);
    } else {
      setLogs([]);
    }
  }, [selectedTask?.id]);

  async function run(action: () => Promise<void>) {
    setError("");
    setLoading(true);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "処理に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function loadProjects() {
    await run(async () => {
      const nextProjects = await api.listProjects();
      setProjects(nextProjects);
      setActiveProjectId((current) => current || nextProjects[0]?.id || "");
    });
  }

  async function loadTasks(projectId: string) {
    await run(async () => {
      const nextTasks = await api.listTasks(projectId);
      setTasks(nextTasks);
      setSelectedTaskId((current) => current || nextTasks[0]?.id || "");
    });
  }

  async function reloadLogs(taskId: string) {
    await api.listTaskLogs(taskId).then(setLogs).catch(() => setLogs([]));
  }

  async function createProject() {
    const name = projectName.trim();
    if (!name) return;
    await run(async () => {
      const project = await api.createProject(name);
      setProjectName("");
      setProjects((current) => [project, ...current]);
      setActiveProjectId(project.id);
    });
  }

  async function createRootTask() {
    const title = taskTitle.trim();
    if (!title || !activeProjectId) return;
    await run(async () => {
      const task = await api.createTask(activeProjectId, title, undefined, { gantt_color: randomGanttColor() });
      setTaskTitle("");
      setTasks((current) => [...current, task]);
      setSelectedTaskId(task.id);
      await reloadLogs(task.id);
    });
  }

  function startChildComposer(parent: TaskNode) {
    setSelectedTaskId(parent.id);
    setCollapsedTaskIds((current) => {
      const next = new Set(current);
      next.delete(parent.id);
      return next;
    });
    setChildComposerParentId(parent.id);
    setChildTitle("");
  }

  function cancelChildComposer() {
    setChildComposerParentId("");
    setChildTitle("");
  }

  async function createChildTask(parent: TaskNode) {
    const title = childTitle.trim();
    if (!title) return;

    await run(async () => {
      const task = await api.createTask(parent.project_id, title, parent.id);
      setTasks((current) => [...current, task]);
      setSelectedTaskId(task.id);
      cancelChildComposer();
      await reloadLogs(task.id);
    });
  }

  async function updateTask(taskId: string, patch: Partial<Task>) {
    await run(async () => {
      const updated = await api.updateTask(taskId, patch);
      setTasks((current) => current.map((task) => (task.id === taskId ? updated : task)));
      if (patch.parent_id) {
        setCollapsedTaskIds((current) => {
          const next = new Set(current);
          next.delete(patch.parent_id!);
          return next;
        });
      }
      if (selectedTaskId === taskId) {
        await reloadLogs(taskId);
      }
    });
  }

  function toggleCollapsed(taskId: string) {
    setCollapsedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }

  async function moveTask(task: TaskNode, direction: "up" | "down") {
    await run(async () => {
      const nextTasks = await api.moveTask(task.id, direction);
      setTasks(nextTasks);
      setSelectedTaskId(task.id);
    });
  }

  async function deleteTask(task: TaskNode | Task) {
    const message =
      "このタスクを削除します。子タスクがある場合は子タスクも削除されます。\n\n" +
      `対象: ${task.title}`;
    if (!window.confirm(message)) return;

    await run(async () => {
      await api.deleteTask(task.id);
      const nextTasks = activeProjectId ? await api.listTasks(activeProjectId) : [];
      setTasks(nextTasks);
      setSelectedTaskId((current) => {
        if (current !== task.id) return current;
        return nextTasks[0]?.id ?? "";
      });
      if (childComposerParentId === task.id) {
        cancelChildComposer();
      }
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Quick WBS</p>
          <h1>開発タスク管理</h1>
        </div>
        <button className="icon-button" onClick={() => activeProjectId && loadTasks(activeProjectId)} title="更新">
          <RefreshCw size={18} />
        </button>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="panel-heading">
            <ListTree size={18} />
            <span>Projects</span>
          </div>
          <div className="inline-form">
            <input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createProject();
              }}
              placeholder="新規プロジェクト"
            />
            <button className="icon-button primary" onClick={createProject} title="プロジェクト追加">
              <Plus size={18} />
            </button>
          </div>
          <div className="project-list">
            {projects.map((project) => (
              <button
                key={project.id}
                className={project.id === activeProjectId ? "project-item active" : "project-item"}
                onClick={() => {
                  setActiveProjectId(project.id);
                  setSelectedTaskId("");
                  cancelChildComposer();
                }}
              >
                {project.name}
              </button>
            ))}
          </div>
        </aside>

        <section className="main-panel">
          <DueAlerts schedule={ganttSchedule} onSelectTask={setSelectedTaskId} />
          <div className="toolbar">
            <div className="inline-form wide">
              <input
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createRootTask();
                }}
                placeholder="ルートタスクを追加"
              />
              <button className="text-button primary" onClick={createRootTask}>
                <Plus size={17} />
                追加
              </button>
            </div>
            {loading && <span className="subtle">処理中...</span>}
            {error && <span className="error">{error}</span>}
          </div>

          <div className="table-wrap">
            <table className="wbs-table">
              <thead>
                <tr>
                  <th>WBS</th>
                  <th>タスク</th>
                  <th>状態</th>
                  <th>優先</th>
                  <th>担当</th>
                  <th>期限</th>
                  <th>進捗</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((task) => (
                  <Fragment key={task.id}>
                    <TaskRow
                      task={task}
                      selected={selectedTask?.id === task.id}
                      collapsed={collapsedTaskIds.has(task.id)}
                      hasChildren={task.children.length > 0}
                      onSelect={() => setSelectedTaskId(task.id)}
                      onToggleCollapse={() => toggleCollapsed(task.id)}
                      onCreateChild={() => startChildComposer(task)}
                      onMoveUp={() => moveTask(task, "up")}
                      onMoveDown={() => moveTask(task, "down")}
                      onDelete={() => deleteTask(task)}
                      onUpdate={(patch) => updateTask(task.id, patch)}
                    />
                    {childComposerParentId === task.id && (
                      <ChildTaskComposer
                        key={`${task.id}-child-composer`}
                        depth={task.depth + 1}
                        value={childTitle}
                        onChange={setChildTitle}
                        onCancel={cancelChildComposer}
                        onSubmit={() => createChildTask(task)}
                      />
                    )}
                  </Fragment>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="empty">
                      プロジェクトを作成し、タスクを追加してください。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <GanttChart schedule={ganttSchedule} onSelectTask={setSelectedTaskId} />
        </section>

        <aside className="detail-panel">
          <div className="panel-heading">
            <CircleDot size={18} />
            <span>Task Detail</span>
          </div>
          {selectedTask ? (
            <TaskDetail
              key={selectedTask.id}
              task={selectedTask}
              logs={logs}
              parentOptions={parentOptions}
              onDelete={() => deleteTask(selectedTask)}
              onUpdate={(patch) => updateTask(selectedTask.id, patch)}
            />
          ) : (
            <p className="subtle">タスクを選択してください。</p>
          )}
        </aside>
      </section>
    </main>
  );
}

function DueAlerts({
  schedule,
  onSelectTask,
}: {
  schedule: ReturnType<typeof buildGanttSchedule>;
  onSelectTask: (taskId: string) => void;
}) {
  if (!schedule) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueAlerts = schedule.items
    .filter((item) => item.dueDate && item.status !== "done")
    .map((item) => ({ item, daysLeft: daysBetween(today, item.dueDate!) }))
    .filter(({ item, daysLeft }) => item.dueDate! < today || daysLeft <= 7)
    .sort((left, right) => left.item.dueDate!.getTime() - right.item.dueDate!.getTime())
    .slice(0, 5);

  if (dueAlerts.length === 0) return null;

  return (
    <div className="gantt-alerts">
      {dueAlerts.map(({ item, daysLeft }) => (
        <button
          key={item.id}
          className={`gantt-alert ${item.dueDate! < today ? "overdue" : "soon"}`}
          onClick={() => onSelectTask(item.id)}
        >
          <span className="gantt-color-dot" style={{ backgroundColor: item.color }} />
          <span className="mono">{item.wbsNumber}</span>
          <strong>{item.title}</strong>
          <span>{item.dueDate! < today ? "期限超過" : `あと${daysLeft}日`}</span>
        </button>
      ))}
    </div>
  );
}

function GanttChart({
  schedule,
  onSelectTask,
}: {
  schedule: ReturnType<typeof buildGanttSchedule>;
  onSelectTask: (taskId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (!schedule) {
    return (
      <section className="gantt-panel">
        <div className="gantt-header">
          <div className="panel-heading">
            <StretchHorizontal size={18} />
            <span>Gantt</span>
          </div>
        </div>
        <p className="subtle">タスクを追加すると自動でガントチャートを生成します。</p>
      </section>
    );
  }

  const totalDays = Math.max(1, daysBetween(schedule.start, schedule.end) + 1);
  const today = new Date();
  const dueAlerts: Array<{ item: (typeof schedule.items)[number]; daysLeft: number }> = [];

  return (
    <section className="gantt-panel">
      <div className="gantt-header">
        <div className="panel-heading">
          <StretchHorizontal size={18} />
          <span>Gantt</span>
        </div>
        <button className="text-button" onClick={() => setCollapsed((current) => !current)}>
          {collapsed ? "表示" : "折りたたみ"}
        </button>
      </div>
      {!collapsed && (
        <>
          {dueAlerts.length > 0 && (
            <div className="gantt-alerts">
              {dueAlerts.map(({ item, daysLeft }) => (
                <button
                  key={item.id}
                  className={`gantt-alert ${item.dueDate! < today ? "overdue" : "soon"}`}
                  onClick={() => onSelectTask(item.id)}
                >
                  <span className="gantt-color-dot" style={{ backgroundColor: item.color }} />
                  <span className="mono">{item.wbsNumber}</span>
                  <strong>{item.title}</strong>
                  <span>{item.dueDate! < today ? "期限超過" : `あと${daysLeft}日`}</span>
                </button>
              ))}
            </div>
          )}
          <div className="gantt-scroll">
          <div className="gantt-grid" style={{ minWidth: `${280 + totalDays * 34}px` }}>
            <div className="gantt-task-header">タスク</div>
            <div className="gantt-days" style={{ gridTemplateColumns: `repeat(${totalDays}, 34px)` }}>
              {schedule.days.map((day) => {
                const tone = getDateTone(day);
                const holidayName = getJapaneseHolidayName(day);
                return (
                  <div
                    key={day.toISOString()}
                    className={`gantt-day day-${tone} ${isToday(day) ? "is-today" : ""}`}
                    title={holidayName ?? undefined}
                  >
                    {formatDateLabel(day)}
                  </div>
                );
              })}
            </div>
            {schedule.items.map((item) => {
              const displayStart = item.start < schedule.start ? schedule.start : item.start;
              const displayEnd = item.end > schedule.end ? schedule.end : item.end;
              const offset = daysBetween(schedule.start, displayStart);
              const span = Math.max(1, daysBetween(displayStart, displayEnd) + 1);
              return (
                <div className="gantt-row" key={item.id}>
                  <button className="gantt-task-name" onClick={() => onSelectTask(item.id)} style={{ paddingLeft: `${item.depth * 16 + 10}px` }}>
                    <span className="gantt-color-dot" style={{ backgroundColor: item.color }} />
                    <span className="mono">{item.wbsNumber}</span>
                    <span>{item.title}</span>
                    {item.isAutoScheduled && <span className="auto-badge">自動配置</span>}
                  </button>
                  <div className="gantt-timeline" style={{ gridTemplateColumns: `repeat(${totalDays}, 34px)` }}>
                    {schedule.days.map((day, index) => {
                      const tone = getDateTone(day);
                      return (
                        <i
                          key={day.toISOString()}
                          className={`gantt-day-band day-${tone} ${isToday(day) ? "is-today" : ""}`}
                          style={{ gridColumn: `${index + 1} / span 1` }}
                        />
                      );
                    })}
                    <div
                      className="gantt-bar"
                      style={{
                        gridColumn: `${offset + 1} / span ${span}`,
                        backgroundColor: item.color,
                      }}
                      title={`${item.title}: ${formatDateLabel(item.start)} - ${formatDateLabel(item.end)}`}
                    >
                      <span style={{ width: `${item.progress}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          </div>
        </>
      )}
    </section>
  );
}

function collectDescendantIds(task: TaskNode): string[] {
  return task.children.flatMap((child) => [child.id, ...collectDescendantIds(child)]);
}

function ChildTaskComposer({
  depth,
  value,
  onChange,
  onCancel,
  onSubmit,
}: {
  depth: number;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <tr className="child-composer-row">
      <td className="mono">新規</td>
      <td colSpan={6}>
        <div className="child-composer" style={{ paddingLeft: `${depth * 20 + 8}px` }}>
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSubmit();
              if (event.key === "Escape") onCancel();
            }}
            placeholder="子タスク名"
          />
          <button className="text-button primary" onClick={onSubmit}>
            <Plus size={16} />
            追加
          </button>
          <button className="icon-button" onClick={onCancel} title="キャンセル">
            <X size={16} />
          </button>
        </div>
      </td>
      <td></td>
    </tr>
  );
}

function TaskRow({
  task,
  selected,
  collapsed,
  hasChildren,
  onSelect,
  onToggleCollapse,
  onCreateChild,
  onMoveUp,
  onMoveDown,
  onDelete,
  onUpdate,
}: {
  task: TaskNode;
  selected: boolean;
  collapsed: boolean;
  hasChildren: boolean;
  onSelect: () => void;
  onToggleCollapse: () => void;
  onCreateChild: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<Task>) => void;
}) {
  const [title, setTitle] = useState(task.title);

  useEffect(() => {
    setTitle(task.title);
  }, [task.title]);

  const saveTitle = () => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      setTitle(task.title);
      return;
    }
    if (nextTitle !== task.title) {
      void onUpdate({ title: nextTitle });
    }
  };

  return (
    <tr className={selected ? "selected" : ""} onClick={onSelect}>
      <td>
        <div className="wbs-cell">
          {hasChildren ? (
            <button
              className="tree-toggle"
              onClick={(event) => {
                event.stopPropagation();
                onToggleCollapse();
              }}
              title={collapsed ? "展開" : "折りたたみ"}
            >
              {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
            </button>
          ) : (
            <span className="tree-spacer" />
          )}
          <span className="mono">{task.wbsNumber}</span>
        </div>
      </td>
      <td>
        <input
          className="table-input"
          style={{ paddingLeft: `${task.depth * 20 + 8}px` }}
          value={title}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={saveTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setTitle(task.title);
              event.currentTarget.blur();
            }
          }}
        />
      </td>
      <td>
        <select
          value={task.status}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onUpdate({ status: event.target.value as TaskStatus })}
        >
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select
          value={task.priority}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onUpdate({ priority: event.target.value as TaskPriority })}
        >
          {Object.entries(priorityLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </td>
      <td className="assignee">
        {task.assignee_type === "ai" ? <Bot size={15} /> : <UserRound size={15} />}
        {task.assignee_name || "-"}
      </td>
      <td>{task.due_date || "-"}</td>
      <td>
        <div className="progress">
          <span style={{ width: `${task.progress}%` }} />
        </div>
      </td>
      <td>
        <div className="row-actions">
          <button
            className="icon-button"
            onClick={(event) => {
              event.stopPropagation();
              onMoveUp();
            }}
            title="上へ移動"
          >
            <ArrowUp size={16} />
          </button>
          <button
            className="icon-button"
            onClick={(event) => {
              event.stopPropagation();
              onMoveDown();
            }}
            title="下へ移動"
          >
            <ArrowDown size={16} />
          </button>
          <button
            className="icon-button"
            onClick={(event) => {
              event.stopPropagation();
              onCreateChild();
            }}
            title="子タスク追加"
          >
            <Plus size={16} />
          </button>
          <button
            className="icon-button danger"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            title="タスク削除"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function TaskDetail({
  task,
  logs,
  parentOptions,
  onDelete,
  onUpdate,
}: {
  task: Task;
  logs: TaskLog[];
  parentOptions: TaskNode[];
  onDelete: () => void;
  onUpdate: (patch: Partial<Task>) => void;
}) {
  const [draft, setDraft] = useState({
    title: task.title,
    parent_id: task.parent_id ?? "",
    description: task.description ?? "",
    acceptance_criteria: task.acceptance_criteria ?? "",
    assignee_type: task.assignee_type ?? "",
    assignee_name: task.assignee_name ?? "",
    start_date: task.start_date ?? "",
    due_date: task.due_date ?? "",
    estimate_hours: task.estimate_hours ?? "",
    actual_hours: task.actual_hours ?? "",
    gantt_color: task.gantt_color ?? randomGanttColor(),
    progress: String(task.progress),
  });

  useEffect(() => {
    setDraft({
      title: task.title,
      parent_id: task.parent_id ?? "",
      description: task.description ?? "",
      acceptance_criteria: task.acceptance_criteria ?? "",
      assignee_type: task.assignee_type ?? "",
      assignee_name: task.assignee_name ?? "",
      start_date: task.start_date ?? "",
      due_date: task.due_date ?? "",
      estimate_hours: task.estimate_hours ?? "",
      actual_hours: task.actual_hours ?? "",
      gantt_color: task.gantt_color ?? randomGanttColor(),
      progress: String(task.progress),
    });
  }, [task]);

  const updateDraft = (key: keyof typeof draft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const saveText = (key: "title" | "description" | "acceptance_criteria") => {
    const value = draft[key].trim();
    const current = (task[key] ?? "").trim();
    if (key === "title" && !value) {
      updateDraft("title", task.title);
      return;
    }
    if (value !== current) {
      void onUpdate({ [key]: value || null } as Partial<Task>);
    }
  };

  const saveNullable = (key: "assignee_type" | "assignee_name" | "start_date" | "due_date" | "estimate_hours" | "actual_hours") => {
    const value = draft[key].trim();
    if (value !== String(task[key] ?? "")) {
      void onUpdate({ [key]: value || null } as Partial<Task>);
    }
  };

  const saveProgress = () => {
    const value = Math.max(0, Math.min(100, Number(draft.progress || 0)));
    if (value !== Number(task.progress)) {
      void onUpdate({ progress: value });
    }
    updateDraft("progress", String(value));
  };

  const saveGanttColor = (value: string) => {
    updateDraft("gantt_color", value);
    if (value !== task.gantt_color) {
      void onUpdate({ gantt_color: value });
    }
  };

  return (
    <div className="task-detail">
      <label>
        タイトル
        <input
          value={draft.title}
          onChange={(event) => updateDraft("title", event.target.value)}
          onBlur={() => saveText("title")}
        />
      </label>
      <div className="detail-grid">
        {task.parent_id === null && (
          <label>
            <span className="label-with-icon">
              <Palette size={14} />
              Gantt Color
            </span>
            <div className="color-control">
              <input
                type="color"
                value={draft.gantt_color}
                onInput={(event) => saveGanttColor(event.currentTarget.value)}
                onChange={(event) => saveGanttColor(event.target.value)}
              />
              <span className="color-value">{draft.gantt_color}</span>
            </div>
          </label>
        )}
        <label>
          親タスク
          <select
            value={draft.parent_id}
            onChange={(event) => {
              updateDraft("parent_id", event.target.value);
              void onUpdate({ parent_id: event.target.value || null });
            }}
          >
            <option value="">ルート</option>
            {parentOptions.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {`${parent.wbsNumber} ${parent.title}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          状態
          <select value={task.status} onChange={(event) => onUpdate({ status: event.target.value as TaskStatus })}>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          優先度
          <select value={task.priority} onChange={(event) => onUpdate({ priority: event.target.value as TaskPriority })}>
            {Object.entries(priorityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          担当種別
          <select
            value={draft.assignee_type}
            onChange={(event) => {
              updateDraft("assignee_type", event.target.value);
              void onUpdate({ assignee_type: event.target.value ? (event.target.value as AssigneeType) : null });
            }}
          >
            <option value="">未設定</option>
            {Object.entries(assigneeTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          担当者
          <input
            value={draft.assignee_name}
            onChange={(event) => updateDraft("assignee_name", event.target.value)}
            onBlur={() => saveNullable("assignee_name")}
          />
        </label>
      </div>
      <label>
        説明
        <textarea value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} onBlur={() => saveText("description")} />
      </label>
      <label>
        受け入れ条件
        <textarea
          value={draft.acceptance_criteria}
          onChange={(event) => updateDraft("acceptance_criteria", event.target.value)}
          onBlur={() => saveText("acceptance_criteria")}
        />
      </label>
      <div className="detail-grid">
        <label>
          <CalendarDays size={16} />
          開始
          <input
            type="date"
            value={draft.start_date}
            onChange={(event) => updateDraft("start_date", event.target.value)}
            onBlur={() => saveNullable("start_date")}
          />
        </label>
        <label>
          <CalendarDays size={16} />
          期限
          <input
            type="date"
            value={draft.due_date}
            onChange={(event) => updateDraft("due_date", event.target.value)}
            onBlur={() => saveNullable("due_date")}
          />
        </label>
        <label>
          <Clock3 size={16} />
          見積
          <input
            type="number"
            min="0"
            value={draft.estimate_hours}
            onChange={(event) => updateDraft("estimate_hours", event.target.value)}
            onBlur={() => saveNullable("estimate_hours")}
          />
        </label>
        <label>
          実績
          <input
            type="number"
            min="0"
            value={draft.actual_hours}
            onChange={(event) => updateDraft("actual_hours", event.target.value)}
            onBlur={() => saveNullable("actual_hours")}
          />
        </label>
        <label>
          <CheckCircle2 size={16} />
          進捗
          <input
            type="number"
            min="0"
            max="100"
            value={draft.progress}
            onChange={(event) => updateDraft("progress", event.target.value)}
            onBlur={saveProgress}
          />
        </label>
      </div>
      <button className="text-button danger" onClick={onDelete}>
        <Trash2 size={17} />
        タスクを削除
      </button>
      <section className="log-list">
        <h2>作業ログ</h2>
        {logs.map((log) => (
          <article key={log.id} className="log-item">
            <strong>{log.action}</strong>
            <span>
              {log.actor_type} / {log.actor_name}
            </span>
            {log.message && <p>{log.message}</p>}
          </article>
        ))}
        {logs.length === 0 && <p className="subtle">まだログはありません。</p>}
      </section>
    </div>
  );
}
