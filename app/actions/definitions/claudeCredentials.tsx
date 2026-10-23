import { KeyIcon } from "outline-icons";
import stores from "~/stores";
import ClaudeCredentialModal from "~/scenes/ClaudeCredentialModal";
import { createAction } from "..";
import { NavigationSection } from "../sections";

export const openClaudeCredentials = createAction({
  name: ({ t }) => t("Claude Connection"),
  analyticsName: "Open Claude credentials",
  section: NavigationSection,
  icon: <KeyIcon />,
  perform: ({ t }) => {
    stores.dialogs.openModal({
      title: t("Claude Connection"),
      content: (
        <ClaudeCredentialModal onClose={stores.dialogs.closeAllModals} />
      ),
    });
  },
});
