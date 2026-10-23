"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn("test_results", "srs_section", {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.changeColumn("test_results", "requirement_id", {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn("test_results", "srs_section", {
      type: Sequelize.STRING(100),
      allowNull: true,
    });
    await queryInterface.changeColumn("test_results", "requirement_id", {
      type: Sequelize.STRING(100),
      allowNull: true,
    });
  },
};
