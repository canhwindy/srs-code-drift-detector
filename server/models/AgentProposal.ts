import { DataTypes } from "sequelize";
import { Column, Table, BelongsTo, ForeignKey } from "sequelize-typescript";
import IdModel from "./base/IdModel";
import GapFinding from "./GapFinding";
import Fix from "./decorators/Fix";

@Table({ tableName: "agent_proposals", modelName: "agent_proposal", underscored: true, paranoid: true })
@Fix
class AgentProposal extends IdModel<AgentProposal> {
  @ForeignKey(() => GapFinding)
  @Column(DataTypes.UUID)
  gapFindingId: string | null;

  @BelongsTo(() => GapFinding, { foreignKey: "gap_finding_id", onDelete: "CASCADE" })
  gapFinding: GapFinding;

  @Column(DataTypes.STRING(100))
  proposalType: string | null;

  @Column(DataTypes.TEXT)
  summary: string | null;

  @Column(DataTypes.JSONB)
  evaluation: {
    warnings: { type: string; node: string; message: string; appears_in_docs?: string[]; context_snippets?: { doc: string; text: string }[] }[];
    intent_summary: { add: number; update: number; delete: number };
    node_counts: { total: number; external_ref: number; internal_only: number };
  } | null;

  @Column({ type: DataTypes.STRING(20), defaultValue: "pending" })
  status: "pending" | "approved" | "rejected" | "applied";
}

export default AgentProposal;
