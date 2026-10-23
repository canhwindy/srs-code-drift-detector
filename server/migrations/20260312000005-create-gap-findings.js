'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("gap_findings", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
      },
      document_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: "documents",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      title: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      pull_request_id: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      severity: {
        type: Sequelize.STRING(50),
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
    }).catch(() => {
      // Table may already exist — ignore
    });

    await queryInterface.addConstraint("gap_findings", {
      fields: ["severity"],
      type: "check",
      name: "gap_findings_severity_check",
      where: {
        severity: ["Low", "Medium", "High", "Critical"],
      },
    }).catch(() => {
      // Constraint may already exist — ignore
    });

    await queryInterface.addConstraint("gap_findings", {
      fields: ["status"],
      type: "check",
      name: "gap_findings_status_check",
      where: {
        status: ["approved", "pending", "rejected"],
      },
    }).catch(() => {
      // Constraint may already exist — ignore
    });

    await queryInterface.addIndex("gap_findings", ["document_id"]).catch(() => {
      // Index may already exist — ignore
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("gap_findings");
  },
};
