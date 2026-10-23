import { DataTypes } from "sequelize";
import { Column, Table, BelongsTo, ForeignKey } from "sequelize-typescript";
import IdModel from "./base/IdModel";
import Document from "./Document";
import Team from "./Team";
import Fix from "./decorators/Fix";

@Table({ tableName: "gap_findings", modelName: "gap_finding", underscored: true, paranoid: true })
@Fix
class GapFinding extends IdModel<GapFinding> {
  @ForeignKey(() => Document)
  @Column(DataTypes.UUID)
  documentId: string | null;

  @BelongsTo(() => Document, { foreignKey: "document_id", onDelete: "CASCADE" })
  document: Document;

  @ForeignKey(() => Team)
  @Column(DataTypes.UUID)
  teamId: string | null;

  @BelongsTo(() => Team, "teamId")
  team: Team;

  @Column(DataTypes.STRING(255))
  title: string;

  @Column(DataTypes.STRING(100))
  pullRequestId: string | null;

  @Column(DataTypes.TEXT)
  description: string | null;

  @Column(DataTypes.STRING(50))
  severity: string | null;

  @Column({ type: DataTypes.STRING(20), defaultValue: "pending" })
  status: "pending" | "approved" | "rejected";
}

export default GapFinding;
