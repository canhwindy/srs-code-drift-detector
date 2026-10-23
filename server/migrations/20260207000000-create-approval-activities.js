'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("approval_activities", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
      },
      action: {
        type: Sequelize.ENUM("ChangeCode", "ChangeSRS"),
        allowNull: false,
      },
      gapFindingId: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      useCaseId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      agentProposalId: {
        type: Sequelize.STRING,
        allowNull: true,
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
      teamId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "teams",
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

    await queryInterface.addIndex("approval_activities", ["userId"]);
    await queryInterface.addIndex("approval_activities", ["teamId"]);
    await queryInterface.addIndex("approval_activities", ["gapFindingId"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("approval_activities");
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_approval_activities_action";'
    );
  },
};
