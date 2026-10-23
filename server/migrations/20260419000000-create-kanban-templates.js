"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableExists = await queryInterface.tableExists("kanban_templates");
    if (tableExists) {
      return;
    }

    await queryInterface.createTable("kanban_templates", {
      id: {
        type: Sequelize.STRING(36),
        primaryKey: true,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      user_id: {
        type: Sequelize.STRING(36),
        allowNull: false,
      },
      team_id: {
        type: Sequelize.STRING(36),
        allowNull: false,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("NOW()"),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("NOW()"),
      },
    });

    await queryInterface.addIndex("kanban_templates", ["user_id", "team_id"]);
    await queryInterface.addIndex("kanban_templates", ["user_id", "team_id", "is_active"]);
  },

  async down(queryInterface) {
    const tableExists = await queryInterface.tableExists("kanban_templates");
    if (tableExists) {
      await queryInterface.dropTable("kanban_templates");
    }
  },
};
