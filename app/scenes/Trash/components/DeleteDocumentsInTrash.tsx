import { observer } from "mobx-react";
import { useTranslation, Trans } from "react-i18next";
import ConfirmationDialog from "~/components/ConfirmationDialog";
import Flex from "~/components/Flex";
import useStores from "~/hooks/useStores";

type Props = {
  onSubmit: () => void;
  shouldRedirect: boolean;
};

function DeleteDocumentsInTrash({ onSubmit }: Props) {
  const { t } = useTranslation();
  const { emptyTrash } = useStores();

  const handleSubmit = async () => {
    // Close dialog immediately — progress is tracked by EmptyTrashStore
    // and shown inline on the Trash page + floating widget on other pages
    onSubmit();
    emptyTrash.startEmptying();
  };

  return (
    <Flex column>
      <ConfirmationDialog
        submitText={t("I’m sure – Delete")}
        savingText={`${t("Deleting")}…`}
        onSubmit={handleSubmit}
        danger
      >
        <Trans defaults="Are you sure you want to permanently delete all the documents in Trash? This action is immediate and cannot be undone." />
      </ConfirmationDialog>
    </Flex>
  );
}

export default observer(DeleteDocumentsInTrash);
