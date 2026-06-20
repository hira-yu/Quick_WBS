ALTER TABLE projects
  ADD COLUMN guest_view_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER owner_user_id,
  ADD COLUMN guest_view_token VARCHAR(64) NULL AFTER guest_view_enabled,
  ADD COLUMN guest_view_created_at DATETIME NULL AFTER guest_view_token,
  ADD COLUMN guest_view_updated_at DATETIME NULL AFTER guest_view_created_at;

CREATE UNIQUE INDEX uq_projects_guest_view_token
  ON projects(guest_view_token);
