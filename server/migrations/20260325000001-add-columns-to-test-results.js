'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('test_results', 'test_code', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('test_results', 'requirement_id', {
      type: Sequelize.STRING(100),
      allowNull: true,
    });
    await queryInterface.addColumn('test_results', 'srs_section', {
      type: Sequelize.STRING(100),
      allowNull: true,
    });
    await queryInterface.addColumn('test_results', 'error_message', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('test_results', 'tag_reason', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('test_results', 'assertion_logic', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('test_results', 'duration_ms', {
      type: Sequelize.FLOAT,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('test_results', 'test_code');
    await queryInterface.removeColumn('test_results', 'requirement_id');
    await queryInterface.removeColumn('test_results', 'srs_section');
    await queryInterface.removeColumn('test_results', 'error_message');
    await queryInterface.removeColumn('test_results', 'tag_reason');
    await queryInterface.removeColumn('test_results', 'assertion_logic');
    await queryInterface.removeColumn('test_results', 'duration_ms');
  },
};
