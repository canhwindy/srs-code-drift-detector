'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.renameColumn("approval_activities", "useCaseId", "documentId");
  },

  async down(queryInterface) {
    await queryInterface.renameColumn("approval_activities", "documentId", "useCaseId");
  },
};
