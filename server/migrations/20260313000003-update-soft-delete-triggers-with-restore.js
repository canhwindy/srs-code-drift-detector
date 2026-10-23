'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION cascade_soft_delete_to_gap_findings()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
          UPDATE gap_findings
          SET deleted_at = NEW.deleted_at
          WHERE document_id = NEW.id AND deleted_at IS NULL;
        ELSIF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
          UPDATE gap_findings
          SET deleted_at = NULL
          WHERE document_id = NEW.id AND deleted_at = OLD.deleted_at;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION cascade_soft_delete_gap_finding_children()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
          UPDATE test_results
          SET deleted_at = NEW.deleted_at
          WHERE gap_finding_id = NEW.id AND deleted_at IS NULL;

          UPDATE agent_proposals
          SET deleted_at = NEW.deleted_at
          WHERE gap_finding_id = NEW.id AND deleted_at IS NULL;
        ELSIF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
          UPDATE test_results
          SET deleted_at = NULL
          WHERE gap_finding_id = NEW.id AND deleted_at = OLD.deleted_at;

          UPDATE agent_proposals
          SET deleted_at = NULL
          WHERE gap_finding_id = NEW.id AND deleted_at = OLD.deleted_at;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
  },

  async down(queryInterface) {
    // Revert to version without restore logic
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION cascade_soft_delete_to_gap_findings()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
          UPDATE gap_findings
          SET deleted_at = NEW.deleted_at
          WHERE document_id = NEW.id AND deleted_at IS NULL;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION cascade_soft_delete_gap_finding_children()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
          UPDATE test_results
          SET deleted_at = NEW.deleted_at
          WHERE gap_finding_id = NEW.id AND deleted_at IS NULL;

          UPDATE agent_proposals
          SET deleted_at = NEW.deleted_at
          WHERE gap_finding_id = NEW.id AND deleted_at IS NULL;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
  },
};
