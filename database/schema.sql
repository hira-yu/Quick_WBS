CREATE TABLE projects (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  created_by VARCHAR(255) NOT NULL,
  updated_by VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  deleted_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tasks (
  id VARCHAR(32) PRIMARY KEY,
  project_id VARCHAR(32) NOT NULL,
  parent_id VARCHAR(32) NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  status ENUM('todo', 'ready', 'in_progress', 'blocked', 'review', 'done') NOT NULL DEFAULT 'todo',
  priority ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium',
  assignee_type ENUM('human', 'ai') NULL,
  assignee_name VARCHAR(255) NULL,
  acceptance_criteria TEXT NULL,
  start_date DATE NULL,
  due_date DATE NULL,
  estimate_hours DECIMAL(8,2) NULL,
  actual_hours DECIMAL(8,2) NULL,
  gantt_color CHAR(7) NULL,
  progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_by VARCHAR(255) NOT NULL,
  updated_by VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  deleted_at DATETIME NULL,
  CONSTRAINT fk_tasks_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_tasks_parent FOREIGN KEY (parent_id) REFERENCES tasks(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_tasks_project_parent_order ON tasks(project_id, parent_id, sort_order);
CREATE INDEX idx_tasks_status ON tasks(status);

CREATE TABLE task_dependencies (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id VARCHAR(32) NOT NULL,
  depends_on_task_id VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_task_dependency (task_id, depends_on_task_id),
  CONSTRAINT fk_task_dependencies_task FOREIGN KEY (task_id) REFERENCES tasks(id),
  CONSTRAINT fk_task_dependencies_depends_on FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE task_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id VARCHAR(32) NOT NULL,
  actor_type ENUM('human', 'ai', 'system') NOT NULL,
  actor_name VARCHAR(255) NOT NULL,
  action VARCHAR(64) NOT NULL,
  message TEXT NULL,
  created_at DATETIME NOT NULL,
  CONSTRAINT fk_task_logs_task FOREIGN KEY (task_id) REFERENCES tasks(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_task_logs_task_created ON task_logs(task_id, created_at);

CREATE TABLE api_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  scopes JSON NULL,
  last_used_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  revoked_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
