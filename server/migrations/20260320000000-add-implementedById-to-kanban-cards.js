"use strict";
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("kanban_cards", "implementedById", {
      type: Sequelize.UUID,
      allowNull: true,
      defaultValue: null,
      references: { model: "users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("kanban_cards", "implementedById");
  },
};
