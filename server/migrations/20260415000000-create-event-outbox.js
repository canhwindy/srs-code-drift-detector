"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("event_outbox", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
        primaryKey: true,
      },
      queue_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      payload: {
        type: Sequelize.JSONB,
        allowNull: false,
      },
      status: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: "pending",
      },
      retry_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      published_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    // Index để relay poll nhanh các record pending theo thứ tự thời gian
    await queryInterface.addIndex("event_outbox", ["status", "created_at"], {
      name: "event_outbox_status_created_at",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("event_outbox");
  },
};
