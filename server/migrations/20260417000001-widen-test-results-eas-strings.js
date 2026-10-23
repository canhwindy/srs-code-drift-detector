"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn("test_results", "title", {
      type: Sequelize.TEXT,
      allowNull: false,
    });
    await queryInterface.changeColumn("test_results", "srs_actor", {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.changeColumn("test_results", "code_actor", {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn("test_results", "title", {
      type: Sequelize.STRING(255),
      allowNull: false,
    });
    await queryInterface.changeColumn("test_results", "srs_actor", {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
    await queryInterface.changeColumn("test_results", "code_actor", {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
  },
};
