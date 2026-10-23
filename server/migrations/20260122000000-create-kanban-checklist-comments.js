"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Create kanban_checklists table
    await queryInterface.createTable("kanban_checklists", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      title: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      index: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      cardId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "kanban_cards",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      createdById: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      deletedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    // Create kanban_checklist_items table
    await queryInterface.createTable("kanban_checklist_items", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      title: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      isCompleted: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      index: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      checklistId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "kanban_checklists",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      completedById: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
      },
      completedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      deletedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    // Create kanban_card_comments table
    await queryInterface.createTable("kanban_card_comments", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      cardId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "kanban_cards",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      createdById: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
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

    // Add indexes
    await queryInterface.addIndex("kanban_checklists", ["cardId"]);
    await queryInterface.addIndex("kanban_checklist_items", ["checklistId"]);
    await queryInterface.addIndex("kanban_card_comments", ["cardId"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("kanban_card_comments");
    await queryInterface.dropTable("kanban_checklist_items");
    await queryInterface.dropTable("kanban_checklists");
  },
};
