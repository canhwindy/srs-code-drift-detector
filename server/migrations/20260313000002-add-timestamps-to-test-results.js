'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("test_results", "created_at", {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
    }).catch(() => {});

    await queryInterface.addColumn("test_results", "updated_at", {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
    }).catch(() => {});
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("test_results", "created_at").catch(() => {});
    await queryInterface.removeColumn("test_results", "updated_at").catch(() => {});
  },
};
