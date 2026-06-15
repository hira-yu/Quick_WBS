import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Clock3,
  ListTree,
  Plus,
  RefreshCw,
  UserRound,
} from "lucide-react";
import { api } from "./api";
import type { Project, Task, TaskLog, TaskNode, TaskPriority, TaskStatus } from "./types";
import { buildTaskTree, flattenTaskTree } from "./wbs";

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

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [projectName, setProjectName] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const tree = useMemo(() => buildTaskTree(tasks), [tasks]);
  const rows = useMemo(() => flattenTaskTree(tree), [tree]);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? rows[0] ?? null;

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    if (activeProjectId) {
      void loadTasks(activeProjectId);
    }
  }, [activeProjectId]);

  useEffect(() => {
    if (selectedTask?.id) {
      void api.listTaskLogs(selectedTask.id).then(setLogs).catch(() => setLogs([]));
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
      const task = await api.createTask(activeProjectId, title);
      setTaskTitle("");
      setTasks((current) => [...current, task]);
      setSelectedTaskId(task.id);
    });
  }

  async function createChildTask(parent: TaskNode) {
    await run(async () => {
      const task = await api.createTask(parent.project_id, `${parent.title} の子タスク`, parent.id);
      setTasks((current) => [...current, task]);
      setSelectedTaskId(task.id);
    });
  }

  async function updateTask(taskId: string, patch: Partial<Task>) {
    await run(async () => {
      const updated = await api.updateTask(taskId, patch);
      setTasks((current) => current.map((task) => (task.id === taskId ? updated : task)));
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
                }}
              >
                {project.name}
              </button>
            ))}
          </div>
        </aside>

        <section className="main-panel">
          <div className="toolbar">
            <div className="inline-form wide">
              <input
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    selected={selectedTask?.id === task.id}
                    onSelect={() => setSelectedTaskId(task.id)}
                    onCreateChild={() => createChildTask(task)}
                    onUpdate={(patch) => updateTask(task.id, patch)}
                  />
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
        </section>

        <aside className="detail-panel">
          <div className="panel-heading">
            <CircleDot size={18} />
            <span>Task Detail</span>
          </div>
          {selectedTask ? (
            <TaskDetail task={selectedTask} logs={logs} onUpdate={(patch) => updateTask(selectedTask.id, patch)} />
          ) : (
            <p className="subtle">タスクを選択してください。</p>
          )}
        </aside>
      </section>
    </main>
  );
}

function TaskRow({
  task,
  selected,
  onSelect,
  onCreateChild,
  onUpdate,
}: {
  task: TaskNode;
  selected: boolean;
  onSelect: () => void;
  onCreateChild: () => void;
  onUpdate: (patch: Partial<Task>) => void;
}) {
  return (
    <tr className={selected ? "selected" : ""} onClick={onSelect}>
      <td className="mono">{task.wbsNumber}</td>
      <td>
        <input
          className="table-input"
          style={{ paddingLeft: `${task.depth * 20 + 8}px` }}
          value={task.title}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onUpdate({ title: event.target.value })}
        />
      </td>
      <td>
        <select value={task.status} onChange={(event) => onUpdate({ status: event.target.value as TaskStatus })}>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select value={task.priority} onChange={(event) => onUpdate({ priority: event.target.value as TaskPriority })}>
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
        <button className="icon-button" onClick={(event) => { event.stopPropagation(); onCreateChild(); }} title="子タスク追加">
          <Plus size={16} />
        </button>
      </td>
    </tr>
  );
}

function TaskDetail({
  task,
  logs,
  onUpdate,
}: {
  task: Task;
  logs: TaskLog[];
  onUpdate: (patch: Partial<Task>) => void;
}) {
  return (
    <div className="task-detail">
      <label>
        説明
        <textarea value={task.description ?? ""} onChange={(event) => onUpdate({ description: event.target.value })} />
      </label>
      <label>
        受け入れ条件
        <textarea
          value={task.acceptance_criteria ?? ""}
          onChange={(event) => onUpdate({ acceptance_criteria: event.target.value })}
        />
      </label>
      <div className="detail-grid">
        <label>
          <CalendarDays size={16} />
          期限
          <input type="date" value={task.due_date ?? ""} onChange={(event) => onUpdate({ due_date: event.target.value || null })} />
        </label>
        <label>
          <Clock3 size={16} />
          見積
          <input
            type="number"
            min="0"
            value={task.estimate_hours ?? ""}
            onChange={(event) => onUpdate({ estimate_hours: event.target.value || null })}
          />
        </label>
        <label>
          <CheckCircle2 size={16} />
          進捗
          <input
            type="number"
            min="0"
            max="100"
            value={task.progress}
            onChange={(event) => onUpdate({ progress: Number(event.target.value) })}
          />
        </label>
      </div>
      <section className="log-list">
        <h2>作業ログ</h2>
        {logs.map((log) => (
          <article key={log.id} className="log-item">
            <strong>{log.action}</strong>
            <span>{log.actor_type} / {log.actor_name}</span>
            {log.message && <p>{log.message}</p>}
          </article>
        ))}
      </section>
    </div>
  );
}

