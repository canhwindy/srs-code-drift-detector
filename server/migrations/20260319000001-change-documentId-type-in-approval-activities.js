'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE approval_activities
      ALTER COLUMN "documentId" TYPE UUID USING "documentId"::UUID;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE approval_activities
      ALTER COLUMN "documentId" TYPE VARCHAR USING "documentId"::VARCHAR;
    `);
  },
};
