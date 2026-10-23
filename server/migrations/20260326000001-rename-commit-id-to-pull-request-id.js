'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const tableDesc = await queryInterface.describeTable('gap_findings');
    if (tableDesc['commit_id']) {
      await queryInterface.renameColumn('gap_findings', 'commit_id', 'pull_request_id');
    }
  },

  async down(queryInterface) {
    await queryInterface.renameColumn('gap_findings', 'pull_request_id', 'commit_id');
  },
};
