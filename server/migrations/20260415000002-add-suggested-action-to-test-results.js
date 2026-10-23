"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("test_results", "suggested_action", {
      type: Sequelize.STRING(20),
      allowNull: true,
    }).catch(() => {});
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("test_results", "suggested_action").catch(() => {});
  },
};
