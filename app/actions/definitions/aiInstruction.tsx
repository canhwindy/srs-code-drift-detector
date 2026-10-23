import { EditIcon } from "outline-icons";
import * as React from "react";
import stores from "~/stores";
import AIInstructionModal from "~/components/Kanban/AIInstructionModal";
import { createAction } from "..";
import { NavigationSection } from "../sections";

export const openAIInstruction = createAction({
  name: ({ t }) => t("AI Instruction Templates"),
  analyticsName: "Open AI instruction templates",
  section: NavigationSection,
  icon: <EditIcon />,
  perform: () => {
    stores.dialogs.openModal({
      title: "AI Instruction Templates",
      content: (
        <AIInstructionModal onClose={stores.dialogs.closeAllModals} />
      ),
      width: 800,
      height: 600,
      top: "64px",
    });
  },
});
