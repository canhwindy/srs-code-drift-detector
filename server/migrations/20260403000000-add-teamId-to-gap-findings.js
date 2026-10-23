"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("gap_findings", "team_id", {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: "teams",
        key: "id",
      },
      onDelete: "CASCADE",
    }).catch(() => {
      // Column may already exist — ignore
    });

    await queryInterface.addIndex("gap_findings", ["team_id"], {
      name: "gap_findings_team_id",
    }).catch(() => {
      // Index may already exist — ignore
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("gap_findings", "gap_findings_team_id").catch(() => {});
    await queryInterface.removeColumn("gap_findings", "team_id").catch(() => {});
  },
};
