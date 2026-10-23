'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Create kanban_boards table
    await queryInterface.createTable("kanban_boards", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      color: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      index: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      teamId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "teams",
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
      deletedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    // Create kanban_lists table
    await queryInterface.createTable("kanban_lists", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      index: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
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
      deletedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    // Create kanban_cards table
    await queryInterface.createTable("kanban_cards", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
      },
      title: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      color: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      index: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      listId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "kanban_lists",
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
      deletedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    // Create kanban_labels table
    await queryInterface.createTable("kanban_labels", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
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

    // Create kanban_card_labels junction table
    await queryInterface.createTable("kanban_card_labels", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
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
      labelId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "kanban_labels",
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

    // Create kanban_card_members junction table
    await queryInterface.createTable("kanban_card_members", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
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
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "users",
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

    // Add indexes for better query performance
    await queryInterface.addIndex("kanban_boards", ["teamId"]);
    await queryInterface.addIndex("kanban_boards", ["createdById"]);
    await queryInterface.addIndex("kanban_lists", ["boardId"]);
    await queryInterface.addIndex("kanban_cards", ["listId"]);
    await queryInterface.addIndex("kanban_cards", ["createdById"]);
    await queryInterface.addIndex("kanban_labels", ["boardId"]);
    await queryInterface.addIndex("kanban_card_labels", ["cardId"]);
    await queryInterface.addIndex("kanban_card_labels", ["labelId"]);
    await queryInterface.addIndex("kanban_card_members", ["cardId"]);
    await queryInterface.addIndex("kanban_card_members", ["userId"]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("kanban_card_members");
    await queryInterface.dropTable("kanban_card_labels");
    await queryInterface.dropTable("kanban_labels");
    await queryInterface.dropTable("kanban_cards");
    await queryInterface.dropTable("kanban_lists");
    await queryInterface.dropTable("kanban_boards");
  }
};
