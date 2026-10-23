import { DataTypes } from "sequelize";
import { Column, Table } from "sequelize-typescript";
import IdModel from "./base/IdModel";
import Fix from "./decorators/Fix";

@Table({ tableName: "event_outbox", modelName: "event_outbox", underscored: true })
@Fix
class EventOutbox extends IdModel<EventOutbox> {
  /** Tên queue RabbitMQ đích — "github_config_events" hoặc "team_events" */
  @Column(DataTypes.STRING(100))
  queueName: string;

  /** Payload JSON sẽ được publish lên queue */
  @Column(DataTypes.JSONB)
  payload: object;

  /** Trạng thái relay: pending → published hoặc failed */
  @Column({ type: DataTypes.STRING(20), defaultValue: "pending" })
  status: "pending" | "published" | "failed";

  /** Số lần thử publish thất bại */
  @Column({ type: DataTypes.INTEGER, defaultValue: 0 })
  retryCount: number;

  /** Thời điểm publish thành công lên RabbitMQ (null nếu chưa published) */
  @Column({ type: DataTypes.DATE, allowNull: true })
  publishedAt: Date | null;
}

export default EventOutbox;
