"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("kanban_cards", "implementStatus", {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: "idle",
    });

    await queryInterface.addColumn("kanban_cards", "implementError", {
      type: Sequelize.TEXT,
      allowNull: true,
      defaultValue: null,
    });

    await queryInterface.addColumn("kanban_cards", "implementedDocumentId", {
      type: Sequelize.UUID,
      allowNull: true,
      defaultValue: null,
      references: {
        model: "documents",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("kanban_cards", "implementedDocumentId");
    await queryInterface.removeColumn("kanban_cards", "implementError");
    await queryInterface.removeColumn("kanban_cards", "implementStatus");
  },
};
