'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeIndex(
      "user_srs_instructions",
      "user_srs_instructions_gap_finding_id"
    ).catch(() => {
      // Index may not exist under this name — ignore
    });

    await queryInterface.removeIndex(
      "user_srs_instructions",
      "user_srs_instructions_user_gap_unique"
    ).catch(() => {
      // Index may not exist — ignore
    });

    await queryInterface.removeColumn("user_srs_instructions", "gapFindingId").catch(() => {
      // Column may not exist — ignore
    });

    // Ensure userId is unique (one instruction per user)
    await queryInterface.addConstraint("user_srs_instructions", {
      fields: ["userId"],
      type: "unique",
      name: "user_srs_instructions_user_id_unique",
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeConstraint(
      "user_srs_instructions",
      "user_srs_instructions_user_id_unique"
    ).catch(() => {});

    await queryInterface.addColumn("user_srs_instructions", "gapFindingId", {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },
};
