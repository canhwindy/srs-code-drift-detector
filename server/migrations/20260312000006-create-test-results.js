'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("test_results", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
      },
      gap_finding_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "gap_findings",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      title: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      code_to_srs: {
        type: Sequelize.STRING(20),
        allowNull: false,
      },
    });

    await queryInterface.addConstraint("test_results", {
      fields: ["code_to_srs"],
      type: "check",
      name: "check_code_to_srs",
      where: {
        code_to_srs: ["mismatch", "match", "missing", "surplus"],
      },
    });

    await queryInterface.addIndex("test_results", ["gap_finding_id"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("test_results");
  },
};
