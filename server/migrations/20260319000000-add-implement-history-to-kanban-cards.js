"use strict";
module.exports = {
  async up(queryInterface, Sequelize) {
    // Timestamp khi implement hoàn thành (success)
    await queryInterface.addColumn("kanban_cards", "implementedAt", {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
    });
    // JSON array log mọi attempt: [{at, status, error, documentId}]
    await queryInterface.addColumn("kanban_cards", "implementHistory", {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: [],
    });
    // Link về card gốc (nếu đây là card duplicate để retry)
    await queryInterface.addColumn("kanban_cards", "parentCardId", {
      type: Sequelize.UUID,
      allowNull: true,
      defaultValue: null,
      references: { model: "kanban_cards", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("kanban_cards", "parentCardId");
    await queryInterface.removeColumn("kanban_cards", "implementHistory");
    await queryInterface.removeColumn("kanban_cards", "implementedAt");
  },
};
