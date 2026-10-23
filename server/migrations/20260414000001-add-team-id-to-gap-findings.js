'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("gap_findings", "team_id", {
      type: Sequelize.STRING(255),
      allowNull: true,
    }).catch(() => {
      // Column may already exist — ignore
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("gap_findings", "team_id");
  },
};
