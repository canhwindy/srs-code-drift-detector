import { observer } from "mobx-react";
import * as React from "react";
import { colorPalette } from "@shared/utils/collections";
import { ChangesetHelper } from "@shared/editor/lib/ChangesetHelper";
import { richExtensions, withComments } from "@shared/editor/nodes";
import Diff from "@shared/editor/extensions/Diff";
import type Document from "~/models/Document";
import type Revision from "~/models/Revision";
import Flex from "~/components/Flex";
import Editor from "~/components/Editor";
import { documentPath } from "~/utils/routeHelpers";
import { Meta as DocumentMeta } from "./DocumentMeta";
import DocumentTitle from "./DocumentTitle";

type Props = {
  document: Document;
  olderRevision: Revision;
  newerRevision: Revision;
};

function CompareViewer({ document, olderRevision, newerRevision }: Props) {
  const changeset = React.useMemo(
    () =>
      ChangesetHelper.getChangeset(newerRevision.data, olderRevision.data),
    [newerRevision.data, olderRevision.data]
  );

  const extensions = React.useMemo(
    () => [
      ...withComments(richExtensions),
      ...(changeset?.changes
        ? [new Diff({ changes: changeset.changes })]
        : []),
    ],
    [changeset]
  );

  return (
    <Flex auto column>
      <DocumentTitle
        documentId={newerRevision.documentId}
        title={newerRevision.title}
        icon={newerRevision.icon}
        color={newerRevision.color ?? colorPalette[0]}
        readOnly
      />
      <DocumentMeta
        document={document}
        revision={newerRevision}
        to={documentPath(document)}
        $rtl={newerRevision.rtl}
      />
      <Editor
        defaultValue={newerRevision.data}
        extensions={extensions}
        dir={newerRevision.dir}
        readOnly
      />
    </Flex>
  );
}

export default observer(CompareViewer);
