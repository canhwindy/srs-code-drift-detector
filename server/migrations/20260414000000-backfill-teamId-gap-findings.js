"use strict";

/**
 * Backfill team_id on existing gap_findings rows that have NULL team_id.
 * Assigns them to the first (oldest) team in the teams table — the original Outline team.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE gap_findings
      SET team_id = (
        SELECT id FROM teams ORDER BY created_at ASC LIMIT 1
      )
      WHERE team_id IS NULL
        AND deleted_at IS NULL;
    `);
  },

  async down(queryInterface) {
    // Cannot safely reverse a bulk update — leave team_id values in place
    await Promise.resolve();
  },
};
