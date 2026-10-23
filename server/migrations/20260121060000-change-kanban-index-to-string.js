'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Change kanban_lists.index from INTEGER to STRING for fractional indexing
    await queryInterface.changeColumn("kanban_lists", "index", {
      type: Sequelize.STRING(256),
      allowNull: true,
    });

    // Change kanban_cards.index from INTEGER to STRING for fractional indexing
    await queryInterface.changeColumn("kanban_cards", "index", {
      type: Sequelize.STRING(256),
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    // Revert to INTEGER
    await queryInterface.changeColumn("kanban_lists", "index", {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.changeColumn("kanban_cards", "index", {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
  },
};
