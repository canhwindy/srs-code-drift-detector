"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add priority column to kanban_cards
    await queryInterface.addColumn("kanban_cards", "priority", {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: null,
    });

    // Drop kanban_card_labels junction table
    await queryInterface.dropTable("kanban_card_labels");

    // Drop kanban_labels table
    await queryInterface.dropTable("kanban_labels");
  },

  async down(queryInterface, Sequelize) {
    // Recreate kanban_labels table
    await queryInterface.createTable("kanban_labels", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      color: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "#3B82F6",
      },
      boardId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "kanban_boards",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    // Recreate kanban_card_labels junction table
    await queryInterface.createTable("kanban_card_labels", {
      cardId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "kanban_cards",
          key: "id",
        },
        onDelete: "CASCADE",
        primaryKey: true,
      },
      labelId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "kanban_labels",
          key: "id",
        },
        onDelete: "CASCADE",
        primaryKey: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    // Remove priority column from kanban_cards
    await queryInterface.removeColumn("kanban_cards", "priority");
  },
};
