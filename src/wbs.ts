import type { Task, TaskNode } from "./types";

export function buildTaskTree(tasks: Task[]): TaskNode[] {
  const nodes = new Map<string, TaskNode>();
  const roots: TaskNode[] = [];

  for (const task of tasks) {
    nodes.set(task.id, {
      ...task,
      wbsNumber: "",
      depth: 0,
      children: [],
    });
  }

  for (const node of nodes.values()) {
    if (node.parent_id && nodes.has(node.parent_id)) {
      nodes.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (items: TaskNode[]) => {
    items.sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
    for (const item of items) {
      sortNodes(item.children);
    }
  };

  const numberNodes = (items: TaskNode[], prefix = "", depth = 0) => {
    items.forEach((item, index) => {
      item.depth = depth;
      item.wbsNumber = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
      numberNodes(item.children, item.wbsNumber, depth + 1);
    });
  };

  sortNodes(roots);
  numberNodes(roots);
  return roots;
}

export function flattenTaskTree(nodes: TaskNode[]): TaskNode[] {
  return nodes.flatMap((node) => [node, ...flattenTaskTree(node.children)]);
}

