import { KanbanBoard, User } from "@server/models";
import { allow } from "./cancan";
import { and, isTeamModel } from "./utils";

allow(User, "createKanbanBoard", KanbanBoard, (actor) =>
  and(!actor.isGuest, !actor.isViewer)
);

allow(User, "read", KanbanBoard, isTeamModel);

allow(User, ["update", "delete"], KanbanBoard, (actor, board) =>
  and(isTeamModel(actor, board), !actor.isGuest, !actor.isViewer)
);
