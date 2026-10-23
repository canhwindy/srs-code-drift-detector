module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("kanban_card_comments", "attachments", {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: null,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn("kanban_card_comments", "attachments");
  },
};
