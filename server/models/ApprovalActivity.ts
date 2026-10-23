import { DataTypes } from "sequelize";
import { Column, Table, BelongsTo, ForeignKey } from "sequelize-typescript";
import IdModel from "./base/IdModel";
import User from "./User";
import Team from "./Team";
import Document from "./Document";
import Fix from "./decorators/Fix";

@Table({ tableName: "approval_activities", modelName: "approval_activity" })
@Fix
class ApprovalActivity extends IdModel<ApprovalActivity> {
  @Column(DataTypes.ENUM("ChangeCode", "ChangeSRS", "Reject Proposal From Agent"))
  action: "ChangeCode" | "ChangeSRS" | "Reject Proposal From Agent";

  @Column(DataTypes.STRING)
  gapFindingId: string;

  @BelongsTo(() => Document, "documentId")
  document: Document;

  @ForeignKey(() => Document)
  @Column(DataTypes.UUID)
  documentId: string | null;

  @Column(DataTypes.STRING)
  agentProposalId: string | null;

  // associations

  @BelongsTo(() => User, "userId")
  user: User;

  @ForeignKey(() => User)
  @Column(DataTypes.UUID)
  userId: string;

  @BelongsTo(() => Team, "teamId")
  team: Team;

  @ForeignKey(() => Team)
  @Column(DataTypes.UUID)
  teamId: string;
}

export default ApprovalActivity;
