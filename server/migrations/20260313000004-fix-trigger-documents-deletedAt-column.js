'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Fix: documents table uses "deletedAt" (camelCase), not "deleted_at"
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION cascade_soft_delete_to_gap_findings()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW."deletedAt" IS NOT NULL AND OLD."deletedAt" IS NULL THEN
          UPDATE gap_findings
          SET deleted_at = NEW."deletedAt"
          WHERE document_id = NEW.id AND deleted_at IS NULL;
        ELSIF NEW."deletedAt" IS NULL AND OLD."deletedAt" IS NOT NULL THEN
          UPDATE gap_findings
          SET deleted_at = NULL
          WHERE document_id = NEW.id AND deleted_at = OLD."deletedAt";
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
  },

  async down(queryInterface) {
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
  },
};
