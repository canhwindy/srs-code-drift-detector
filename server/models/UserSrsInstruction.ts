import { DataTypes } from "sequelize";
import { Column, Table, BelongsTo, ForeignKey } from "sequelize-typescript";
import IdModel from "./base/IdModel";
import User from "./User";
import Team from "./Team";
import Fix from "./decorators/Fix";

@Table({ tableName: "user_srs_instructions", modelName: "user_srs_instruction" })
@Fix
class UserSrsInstruction extends IdModel<UserSrsInstruction> {
  @Column(DataTypes.JSONB)
  instructions: string[];

  // associations

  @BelongsTo(() => User, "userId")
  user: User;

  @ForeignKey(() => User)
  @Column({ type: DataTypes.UUID, unique: true })
  userId: string;

  @BelongsTo(() => Team, "teamId")
  team: Team;

  @ForeignKey(() => Team)
  @Column(DataTypes.UUID)
  teamId: string;
}

export default UserSrsInstruction;
