import { observer } from "mobx-react";
import { ImportIcon } from "outline-icons";
import { useTranslation } from "react-i18next";
import { importExportPath } from "~/utils/routeHelpers";
import history from "~/utils/history";
import SidebarLink from "./SidebarLink";

export const ImportLink = observer(() => {
  const { t } = useTranslation();

  const handleImport = () => {
    history.push(importExportPath());
  };

  return (
    <SidebarLink
      onClick={handleImport}
      icon={<ImportIcon />}
      label={t("Import & Split")}
    />
  );
});
