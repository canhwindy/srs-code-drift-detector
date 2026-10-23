"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableNames = await queryInterface.showAllTables();
    if (!tableNames.includes("chat_conversations")) {
      return; // bảng chưa tồn tại, bỏ qua migration này
    }

    await queryInterface.sequelize.transaction(async (transaction) => {
      // BƯỚC 1: Xóa data cũ (clean slate)
      // Data cũ không có user_id/workspace_id nên không thể dùng được sau khi thêm columns
      await queryInterface.bulkDelete("chat_messages", null, { transaction });
      await queryInterface.bulkDelete("chat_conversations", null, { transaction });

      // BƯỚC 2: Thêm column user_id
      await queryInterface.addColumn(
        "chat_conversations",
        "user_id",
        {
          type: Sequelize.STRING(36),
          allowNull: false,
          defaultValue: "",
        },
        { transaction }
      );

      // BƯỚC 3: Thêm column workspace_id
      await queryInterface.addColumn(
        "chat_conversations",
        "workspace_id",
        {
          type: Sequelize.STRING(36),
          allowNull: false,
          defaultValue: "",
        },
        { transaction }
      );

      // BƯỚC 4: Thêm column is_deleted
      await queryInterface.addColumn(
        "chat_conversations",
        "is_deleted",
        {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        { transaction }
      );

      // BƯỚC 5: Thêm indexes để tăng tốc query filter
      await queryInterface.addIndex(
        "chat_conversations",
        ["user_id"],
        { transaction }
      );
      await queryInterface.addIndex(
        "chat_conversations",
        ["workspace_id"],
        { transaction }
      );
      await queryInterface.addIndex(
        "chat_conversations",
        ["user_id", "workspace_id", "is_deleted"],
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    const tableNames = await queryInterface.showAllTables();
    if (!tableNames.includes("chat_conversations")) {
      return;
    }
    await queryInterface.removeColumn("chat_conversations", "user_id");
    await queryInterface.removeColumn("chat_conversations", "workspace_id");
    await queryInterface.removeColumn("chat_conversations", "is_deleted");
  },
};
