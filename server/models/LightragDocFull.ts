import { DataTypes, Op } from "sequelize";
import { Column, Table, PrimaryKey } from "sequelize-typescript";
import Model from "./base/Model";
import Fix from "./decorators/Fix";

/**
 * Read-only model for the lightrag_doc_full table managed by LightRAG.
 * Used to resolve the exact doc_name (file path) for a given use case name
 * before passing it to the Python SRS pipeline.
 */
@Table({ tableName: "lightrag_doc_full", modelName: "lightrag_doc_full", timestamps: false })
@Fix
class LightragDocFull extends Model {
  @PrimaryKey
  @Column(DataTypes.STRING)
  id: string;

  @Column(DataTypes.STRING)
  workspace: string;

  @Column(DataTypes.STRING)
  doc_name: string;

  /**
   * Find the doc_name that best matches a use case name.
   * Normalizes the use case name by replacing all non-alphanumeric characters
   * with SQL wildcards so that spaces, colons, dots, etc. in useCaseName
   * match underscores or other separators in the stored doc_name.
   *
   * @returns The matching doc_name string, or empty string if not found.
   */
  static async findDocNamesByUseCaseName(useCaseName: string): Promise<string[]> {
    // Strip leading section numbers (e.g. "3.5.1 ") before building pattern
    const stripped = useCaseName.replace(/^\d+(\.\d+)*\s*/, "");
    const pattern = "%" + stripped.replace(/[^a-zA-Z0-9]+/g, "%") + "%";
    const rows = await this.findAll({
      attributes: ["doc_name"],
      where: {
        doc_name: { [Op.iLike]: pattern },
      },
    });
    return rows.map((r) => r.doc_name);
  }
}

export default LightragDocFull;
