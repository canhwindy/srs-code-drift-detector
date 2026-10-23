'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("user_srs_instructions", "instructions", {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: [],
    });

    await queryInterface.removeColumn("user_srs_instructions", "instruction");
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn("user_srs_instructions", "instruction", {
      type: Sequelize.TEXT,
      allowNull: false,
      defaultValue: "",
    });

    await queryInterface.removeColumn("user_srs_instructions", "instructions");
  },
};
