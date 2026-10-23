'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('kanban_cards', 'relatedDocuments', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: [],
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('kanban_cards', 'relatedDocuments');
  }
};
