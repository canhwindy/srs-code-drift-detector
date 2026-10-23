import { DataTypes } from "sequelize";
import { Column, Table, BelongsTo, ForeignKey, PrimaryKey, IsUUID, Default } from "sequelize-typescript";
import Model from "./base/Model";
import GapFinding from "./GapFinding";
import Fix from "./decorators/Fix";

@Table({ tableName: "test_results", modelName: "test_result", underscored: true, paranoid: true })
@Fix
class TestResult extends Model<TestResult> {
  @IsUUID(4)
  @PrimaryKey
  @Default(DataTypes.UUIDV4)
  @Column(DataTypes.UUID)
  id: string;

  @ForeignKey(() => GapFinding)
  @Column(DataTypes.UUID)
  gapFindingId: string;

  @BelongsTo(() => GapFinding, { foreignKey: "gap_finding_id", onDelete: "CASCADE" })
  gapFinding: GapFinding;

  @Column(DataTypes.TEXT)
  title: string;

  @Column(DataTypes.TEXT)
  description: string | null;

  @Column(DataTypes.STRING(20))
  codeToSrs: "mismatch" | "match" | "missing" | "surplus";

  @Column(DataTypes.TEXT)
  testCode: string | null;

  @Column(DataTypes.TEXT)
  requirementId: string | null;

  @Column(DataTypes.TEXT)
  srsSection: string | null;

  @Column(DataTypes.TEXT)
  errorMessage: string | null;

  @Column(DataTypes.TEXT)
  tagReason: string | null;

  @Column(DataTypes.TEXT)
  assertionLogic: string | null;

  @Column(DataTypes.FLOAT)
  durationMs: number | null;

  // Step number trong UC flow (khớp với SRS)
  @Column(DataTypes.INTEGER)
  stepNumber: number | null;

  // ─── SRS side (EAS row) ───────────────────────────────────────
  @Column(DataTypes.TEXT)
  srsActor: string | null;

  @Column(DataTypes.TEXT)
  srsEvent: string | null;

  @Column(DataTypes.TEXT)
  srsAction: string | null;

  @Column(DataTypes.TEXT)
  srsState: string | null;

  @Column(DataTypes.TEXT)
  srsGuardBr: string | null;

  // ─── Code side (EAS row) ──────────────────────────────────────
  @Column(DataTypes.TEXT)
  codeActor: string | null;

  @Column(DataTypes.TEXT)
  codeEvent: string | null;

  @Column(DataTypes.TEXT)
  codeAction: string | null;

  @Column(DataTypes.TEXT)
  codeState: string | null;

  @Column(DataTypes.TEXT)
  codeGuard: string | null;

  // ─── References cho expand detail ─────────────────────────────
  // code_references: [{file_path, line, snippet, repo, url}]
  @Column(DataTypes.JSONB)
  codeReferences: Array<{
    file_path: string;
    line?: number;
    snippet?: string;
    repo?: string;
    url?: string;
  }> | null;

  // srs_references: [{quote, file_path}]
  @Column(DataTypes.JSONB)
  srsReferences: Array<{
    quote: string;
    file_path?: string;
  }> | null;

  // User-selected remediation per test result — quyết định push sang kanban khi approve
  @Column(DataTypes.STRING(20))
  suggestedAction: "change_code" | "change_srs" | null;
}

export default TestResult;
