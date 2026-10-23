import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  ForeignKey,
  BelongsTo,
  Column,
  Table,
  DataType,
  Unique,
} from "sequelize-typescript";
import Team from "@server/models/Team";
import User from "@server/models/User";
import ParanoidModel from "@server/models/base/ParanoidModel";
import Encrypted from "@server/models/decorators/Encrypted";
import Fix from "@server/models/decorators/Fix";

export interface GithubRepository {
  url: string;
  owner: string;
  repo: string;
  webhookSecret?: string;
}

@Table({ tableName: "github_configs", modelName: "github_config" })
@Fix
class GithubConfig extends ParanoidModel<
  InferAttributes<GithubConfig>,
  Partial<InferCreationAttributes<GithubConfig>>
> {
  /** Encrypted GitHub Personal Access Token */
  @Column(DataType.BLOB)
  @Encrypted
  apiKey: string;

  /** Absolute path to Claude CLI project directory (cwd for subprocess) */
  @Column(DataType.TEXT)
  claudeProjectDir: string | null;

  /** Array of connected repositories (each with optional webhookSecret) */
  @Column(DataType.JSONB)
  repositories: GithubRepository[];

  // associations

  @BelongsTo(() => Team, "teamId")
  team: Team;

  @Unique
  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;

  @BelongsTo(() => User, "userId")
  user: User;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  userId: string;
}

export default GithubConfig;
