import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import styled from "styled-components";
import { toast } from "sonner";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import ConfirmationDialog from "~/components/ConfirmationDialog";
import Flex from "~/components/Flex";
import Text from "~/components/Text";
import useStores from "~/hooks/useStores";
import type { KanbanTemplate } from "./types";
import {
  fetchTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  selectTemplate,
  deselectActiveTemplate,
} from "./api";

// ─── System Default ───────────────────────────────────────────────────────────

const SYSTEM_DEFAULT_NAME = "FSD Use Case Standard (Default)";

const DEFAULT_SAMPLE_INSTRUCTION = `Generate the document following the FSD Use Case standard with exactly 5 sections. Every document includes all 5 required sections; use clear placeholder text for sections where information is insufficient so that a BA can complete them later.

Section 1 — Overview (Thông tin chung):
- ID: Format UC-[PREFIX]-[number], e.g. UC-TM-007. Infer PREFIX from the module or domain name in the card. Use UC-XXX-001 when the prefix cannot be determined.
- Objective (Mục tiêu): Write exactly 1 complete sentence following the pattern: "This feature allows [actor] to [verb + object] in order to [specific purpose]." Infer from the card's title and description.
- Actor (Tác nhân): Bulleted list. Infer from description and context. Example values: Instructor, Tutor, Admin.

Section 2 — Trigger and Pre-conditions (Kích hoạt & Tiền điều kiện):
- Trigger (Kích hoạt): 1 sentence starting with an action verb describing what activates the use case. Example: "Click the 'X' button on the 'Y' screen."
- Pre-conditions (Tiền điều kiện): Bulleted list with at least 2 conditions. The placeholder {Current User} refers to the logged-in user.

Section 3 — Post-conditions (Hậu điều kiện):
- Bulleted list describing the system state after the use case completes successfully.

Section 4 — Activity Flow (Luồng sự kiện):
- Table with 3 columns: Step | User | System
- Each row fills exactly one of the two actor columns (User or System), leaving the other blank.
- Sequence starts with a User action (step 1), followed by a System response (step 2), alternating.
- System actions describe what the system does, displays, or loads in detail.

Section 5 — Business Rules (Quy tắc nghiệp vụ):
- Table with 3 columns: Related Step | BR Code | Detailed Description
- Related Step: Step number from the Activity Flow where this BR applies, in format (N).
- BR Code: Format BR [UC#]-[BR#], e.g. BR 7-1, BR 7-2.
- Detailed Description: May begin with a sub-title rule type such as "Screen Displaying Rules:", "Validation Rules:", or "Authorization Rules:", followed by the detailed description.

Document title format: # UC-[PREFIX]-[ID]: [Use Case Name]`;

// ─── Types ────────────────────────────────────────────────────────────────────

type View = "list" | "create" | "edit" | "view-default";

interface Props {
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AIInstructionModal({ onClose: _onClose }: Props) {
  const { auth, dialogs } = useStores();

  const userId = auth.currentUserId ?? "";
  const teamId = auth.currentTeamId ?? "";

  const [view, setView] = useState<View>("list");
  const [templates, setTemplates] = useState<KanbanTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<KanbanTemplate | null>(null);
  const [formName, setFormName] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const hasActiveUserTemplate = templates.some((t) => t.isActive);

  // ── Fetch templates khi mount ─────────────────────────────────────────────

  const loadTemplates = useCallback(async () => {
    if (!userId || !teamId) { return; }
    setIsLoading(true);
    try {
      const data = await fetchTemplates();
      setTemplates(data);
    } catch (_err) {
      toast.error("Failed to load templates.");
    } finally {
      setIsLoading(false);
    }
  }, [userId, teamId]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  // ── Xem default template ──────────────────────────────────────────────────

  const handleOpenViewDefault = useCallback(() => {
    setFormName(SYSTEM_DEFAULT_NAME);
    setFormContent(DEFAULT_SAMPLE_INSTRUCTION);
    setFormError(null);
    setView("view-default");
  }, []);

  // ── Chọn template ─────────────────────────────────────────────────────────

  const handleSelectSystemDefault = useCallback(async () => {
    if (!hasActiveUserTemplate) { return; }
    try {
      await deselectActiveTemplate();
      setTemplates((prev) => prev.map((t) => ({ ...t, isActive: false })));
    } catch (_err) {
      toast.error("Failed to select default template.");
    }
  }, [hasActiveUserTemplate, userId, teamId]);

  const handleSelectTemplate = useCallback(async (template: KanbanTemplate) => {
    if (template.isActive) { return; }
    try {
      const updated = await selectTemplate(template.id);
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === updated.id ? updated : { ...t, isActive: false }
        )
      );
    } catch (_err) {
      toast.error("Failed to select template.");
    }
  }, [userId, teamId]);

  // ── Xóa template ──────────────────────────────────────────────────────────

  const handleDeleteClick = useCallback((template: KanbanTemplate) => {
    dialogs.openModal({
      title: "Delete template",
      content: (
        <ConfirmationDialog
          onSubmit={async () => {
            await deleteTemplate(template.id);
            setTemplates((prev) => prev.filter((t) => t.id !== template.id));
            toast.success("Template deleted.");
          }}
          submitText="Delete"
          danger
        >
          Are you sure you want to delete the template &quot;{template.name}&quot;?
        </ConfirmationDialog>
      ),
    });
  }, [dialogs]);

  // ── Mở form tạo mới ───────────────────────────────────────────────────────

  const handleOpenCreate = useCallback(() => {
    setEditingTemplate(null);
    setFormName("");
    setFormContent("");
    setFormError(null);
    setView("create");
  }, []);

  // ── Mở form chỉnh sửa ─────────────────────────────────────────────────────

  const handleOpenEdit = useCallback((template: KanbanTemplate) => {
    setEditingTemplate(template);
    setFormName(template.name);
    setFormContent(template.content);
    setFormError(null);
    setView("edit");
  }, []);

  // ── Back về list (discard) ────────────────────────────────────────────────

  const handleBack = useCallback(() => {
    setView("list");
    setFormError(null);
  }, []);

  // ── Validate tên không trùng ──────────────────────────────────────────────

  const isNameDuplicate = useCallback(
    (name: string, excludeId?: string) =>
      templates.some(
        (t) =>
          t.name.trim().toLowerCase() === name.trim().toLowerCase() &&
          t.id !== excludeId
      ),
    [templates]
  );

  // ── Save (create hoặc edit) ───────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    const trimmedName = formName.trim();
    const trimmedContent = formContent.trim();

    if (!trimmedName) {
      setFormError("Template name cannot be empty.");
      return;
    }
    if (!trimmedContent) {
      setFormError("Template content cannot be empty.");
      return;
    }
    if (isNameDuplicate(trimmedName, editingTemplate?.id)) {
      setFormError(`A template named "${trimmedName}" already exists.`);
      return;
    }

    setIsSaving(true);
    setFormError(null);
    try {
      if (view === "create") {
        const created = await createTemplate(trimmedName, trimmedContent);
        setTemplates((prev) =>
          prev.map((t) => ({ ...t, isActive: false })).concat(created)
        );
        toast.success("Template created.");
      } else if (view === "edit" && editingTemplate) {
        const updated = await updateTemplate(editingTemplate.id, trimmedName, trimmedContent);
        setTemplates((prev) =>
          prev.map((t) => (t.id === updated.id ? updated : t))
        );
        toast.success("Template updated.");
      }
      setView("list");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "An unknown error occurred.";
      setFormError(msg);
    } finally {
      setIsSaving(false);
    }
  }, [formName, formContent, view, editingTemplate, userId, teamId, isNameDuplicate]);

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
      {view === "list" ? (
        <ListBody>
          {isLoading ? (
            <LoadingText type="secondary">Loading...</LoadingText>
          ) : (
            <>
              {/* System default item */}
              <TemplateItem
                $isActive={!hasActiveUserTemplate}
                onClick={handleSelectSystemDefault}
                title="Select default template"
              >
                <TemplateItemLeft>
                  <ActiveDot $visible={!hasActiveUserTemplate} />
                  <TemplateInfo>
                    <TemplateName>{SYSTEM_DEFAULT_NAME}</TemplateName>
                    <TemplateBadge>Default</TemplateBadge>
                  </TemplateInfo>
                </TemplateItemLeft>
                <TemplateActions onClick={(e) => e.stopPropagation()}>
                  <ActionButton
                    type="button"
                    onClick={handleOpenViewDefault}
                    title="View template content"
                  >
                    View
                  </ActionButton>
                </TemplateActions>
              </TemplateItem>

              {/* User templates */}
              {templates.map((t) => (
                <TemplateItem
                  key={t.id}
                  $isActive={t.isActive}
                  onClick={() => void handleSelectTemplate(t)}
                  title="Select this template"
                >
                  <TemplateItemLeft>
                    <ActiveDot $visible={t.isActive} />
                    <TemplateName>{t.name}</TemplateName>
                  </TemplateItemLeft>
                  <TemplateActions onClick={(e) => e.stopPropagation()}>
                    <ActionButton
                      type="button"
                      onClick={() => handleOpenEdit(t)}
                      title="Edit"
                    >
                      Edit
                    </ActionButton>
                    <ActionButton
                      type="button"
                      onClick={() => handleDeleteClick(t)}
                      title="Delete"
                      $danger
                    >
                      Delete
                    </ActionButton>
                  </TemplateActions>
                </TemplateItem>
              ))}

              <AddButton neutral onClick={handleOpenCreate}>
                + Add new template
              </AddButton>
            </>
          )}
        </ListBody>
      ) : (
        <FormBody>
          <FormField>
            <FormLabel>Template name</FormLabel>
            <StyledInput
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="E.g.: FSD Use Case - Concise style"
              disabled={isSaving || view === "view-default"}
              autoFocus={view !== "view-default"}
            />
          </FormField>

          <FormField>
            <FormLabel>Instruction content</FormLabel>
            <StyledTextarea
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              placeholder={CONTENT_PLACEHOLDER}
              disabled={isSaving || view === "view-default"}
              rows={18}
            />
          </FormField>

          {formError && <ErrorText>{formError}</ErrorText>}

          <FormActions>
            <Button neutral onClick={handleBack} disabled={isSaving}>
              Back
            </Button>
            {view !== "view-default" && (
              <Button onClick={() => void handleSave()} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save"}
              </Button>
            )}
          </FormActions>
        </FormBody>
      )}
    </>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CONTENT_PLACEHOLDER = `Describe the desired document structure, for example:

Generate the document following the FSD Use Case standard with 5 required sections:
1. General Information (ID, Objective, Actors)
2. Trigger & Pre-conditions
3. Post-conditions
4. Activity Flow (3-column table: Step | User | System)
5. Business Rules (3-column table: Step | BR Code | Description)

Note: AI will use this instruction to generate document content when implementing Kanban cards.`;

// ─── Styled components ────────────────────────────────────────────────────────

const ListBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0 8px;
`;

const FormBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 0 8px;
`;

const LoadingText = styled(Text)`
  text-align: center;
  padding: 24px 0;
`;

const TemplateItem = styled.div<{ $isActive: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1.5px solid
    ${({ $isActive }) => ($isActive ? s("accent") : s("divider"))};
  background: ${({ $isActive }) =>
    $isActive ? "rgba(0, 120, 255, 0.05)" : s("background")};
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;

  &:hover {
    border-color: ${s("accent")};
  }
`;

const TemplateItemLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const ActiveDot = styled.div<{ $visible: boolean }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: ${({ $visible }) => ($visible ? s("accent") : "transparent")};
  border: 1.5px solid ${({ $visible }) => ($visible ? s("accent") : s("textTertiary"))};
`;

const TemplateInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const TemplateName = styled.span`
  font-size: 14px;
  font-weight: 500;
  color: ${s("text")};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const TemplateBadge = styled.span`
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: ${s("backgroundSecondary")};
  color: ${s("textSecondary")};
  flex-shrink: 0;
`;

const TemplateActions = styled.div`
  display: flex;
  gap: 4px;
  flex-shrink: 0;
`;

const ActionButton = styled.button<{ $danger?: boolean }>`
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid ${({ $danger }) => ($danger ? "rgba(220,38,38,0.4)" : s("divider"))};
  background: transparent;
  color: ${({ $danger }) => ($danger ? "rgb(220,38,38)" : s("text"))};
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s;

  &:hover {
    background: ${({ $danger }) =>
      $danger ? "rgba(220,38,38,0.08)" : s("backgroundSecondary")};
  }
`;

const AddButton = styled(Button)`
  align-self: flex-start;
  margin-top: 4px;
`;

const FormField = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const FormLabel = styled.label`
  font-size: 13px;
  font-weight: 500;
  color: ${s("textSecondary")};
`;

const StyledInput = styled.input`
  padding: 8px 12px;
  border-radius: 6px;
  border: 1.5px solid ${s("divider")};
  background: ${s("background")};
  color: ${s("text")};
  font-size: 14px;
  outline: none;
  width: 100%;
  box-sizing: border-box;
  transition: border-color 0.15s;

  &:focus {
    border-color: ${s("accent")};
  }

  &:disabled {
    opacity: 0.6;
  }
`;

const StyledTextarea = styled.textarea`
  padding: 10px 14px;
  border-radius: 6px;
  border: 1.5px solid ${s("divider")};
  background: ${s("background")};
  color: ${s("text")};
  font-size: 13px;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  line-height: 1.65;
  outline: none;
  width: 100%;
  min-height: 320px;
  box-sizing: border-box;
  resize: vertical;
  transition: border-color 0.15s;

  &:focus {
    border-color: ${s("accent")};
  }

  &:disabled {
    opacity: 0.75;
    cursor: default;
  }

  &::placeholder {
    color: ${s("placeholder")};
    font-family: inherit;
  }
`;

const ErrorText = styled.div`
  font-size: 13px;
  color: ${s("danger")};
  padding: 4px 0;
`;

const FormActions = styled(Flex)`
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
`;
