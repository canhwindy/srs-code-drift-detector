'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Add deleted_at to gap_findings
    await queryInterface.addColumn("gap_findings", "deleted_at", {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
    }).catch(() => {});

    // 2. Add deleted_at to test_results
    await queryInterface.addColumn("test_results", "deleted_at", {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
    }).catch(() => {});

    // 3. Add deleted_at to agent_proposals
    await queryInterface.addColumn("agent_proposals", "deleted_at", {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
    }).catch(() => {});

    // 4. Trigger: documents.deleted_at → gap_findings.deleted_at
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION cascade_soft_delete_to_gap_findings()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
          -- soft delete
          UPDATE gap_findings
          SET deleted_at = NEW.deleted_at
          WHERE document_id = NEW.id AND deleted_at IS NULL;
        ELSIF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
          -- restore
          UPDATE gap_findings
          SET deleted_at = NULL
          WHERE document_id = NEW.id AND deleted_at = OLD.deleted_at;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS trigger_soft_delete_gap_findings ON documents;
      CREATE TRIGGER trigger_soft_delete_gap_findings
      AFTER UPDATE ON documents
      FOR EACH ROW EXECUTE FUNCTION cascade_soft_delete_to_gap_findings();
    `);

    // 5. Trigger: gap_findings.deleted_at → test_results + agent_proposals
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION cascade_soft_delete_gap_finding_children()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
          -- soft delete
          UPDATE test_results
          SET deleted_at = NEW.deleted_at
          WHERE gap_finding_id = NEW.id AND deleted_at IS NULL;

          UPDATE agent_proposals
          SET deleted_at = NEW.deleted_at
          WHERE gap_finding_id = NEW.id AND deleted_at IS NULL;
        ELSIF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
          -- restore
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

    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS trigger_soft_delete_gap_finding_children ON gap_findings;
      CREATE TRIGGER trigger_soft_delete_gap_finding_children
      AFTER UPDATE ON gap_findings
      FOR EACH ROW EXECUTE FUNCTION cascade_soft_delete_gap_finding_children();
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS trigger_soft_delete_gap_findings ON documents;
      DROP TRIGGER IF EXISTS trigger_soft_delete_gap_finding_children ON gap_findings;
      DROP FUNCTION IF EXISTS cascade_soft_delete_to_gap_findings();
      DROP FUNCTION IF EXISTS cascade_soft_delete_gap_finding_children();
    `);

    await queryInterface.removeColumn("gap_findings", "deleted_at").catch(() => {});
    await queryInterface.removeColumn("test_results", "deleted_at").catch(() => {});
    await queryInterface.removeColumn("agent_proposals", "deleted_at").catch(() => {});
  },
};
