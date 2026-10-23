"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("kanban_card_comments", "parentId", {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: "kanban_card_comments",
        key: "id",
      },
      onDelete: "CASCADE",
    });

    await queryInterface.addIndex("kanban_card_comments", ["parentId"]);
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex("kanban_card_comments", ["parentId"]);
    await queryInterface.removeColumn("kanban_card_comments", "parentId");
  },
};
