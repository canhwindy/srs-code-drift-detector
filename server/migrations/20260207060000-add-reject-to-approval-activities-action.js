'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_approval_activities_action" ADD VALUE IF NOT EXISTS 'Reject Proposal From Agent';`
    );
  },

  async down(queryInterface) {
    // PostgreSQL does not support removing values from an enum type directly.
    // To revert, you would need to recreate the enum without this value.
    // This is intentionally left as a no-op for safety.
  },
};
