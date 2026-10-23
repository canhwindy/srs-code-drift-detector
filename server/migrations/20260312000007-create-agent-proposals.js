'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("agent_proposals", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
      },
      gap_finding_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: "gap_findings",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      proposal_type: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      summary: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      status: {
        type: Sequelize.STRING(20),
        allowNull: true,
        defaultValue: "pending",
      },
    });

    await queryInterface.addConstraint("agent_proposals", {
      fields: ["status"],
      type: "check",
      name: "agent_proposals_status_check",
      where: {
        status: ["pending", "approved", "rejected", "applied"],
      },
    });

    await queryInterface.addIndex("agent_proposals", ["gap_finding_id"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("agent_proposals");
  },
};
