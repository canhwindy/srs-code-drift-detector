import { client } from "~/utils/ApiClient";
import type { KanbanTemplate } from "./types";

type TemplateResponse = {
  id: string;
  name: string;
  content: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function toKanbanTemplate(r: TemplateResponse): KanbanTemplate {
  return {
    id: r.id,
    name: r.name,
    content: r.content,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ─── API Functions ────────────────────────────────────────────────────────────

export async function fetchTemplates(): Promise<KanbanTemplate[]> {
  const res = await client.post("/kanban.templates.list");
  return (res.data as TemplateResponse[]).map(toKanbanTemplate);
}

export async function createTemplate(
  name: string,
  content: string,
): Promise<KanbanTemplate> {
  const res = await client.post("/kanban.templates.create", { name, content });
  return toKanbanTemplate(res.data as TemplateResponse);
}

export async function updateTemplate(
  id: string,
  name: string,
  content: string,
): Promise<KanbanTemplate> {
  const res = await client.post("/kanban.templates.update", { id, name, content });
  return toKanbanTemplate(res.data as TemplateResponse);
}

export async function deleteTemplate(id: string): Promise<void> {
  await client.post("/kanban.templates.delete", { id });
}

export async function selectTemplate(id: string): Promise<KanbanTemplate> {
  const res = await client.post("/kanban.templates.select", { id });
  return toKanbanTemplate(res.data as TemplateResponse);
}

export async function deselectActiveTemplate(): Promise<void> {
  await client.post("/kanban.templates.deselect");
}
