"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Move the top-level webhookSecret into each repository entry
    const [configs] = await queryInterface.sequelize.query(
      `SELECT id, "webhookSecret", repositories FROM github_configs WHERE "deletedAt" IS NULL`
    );

    for (const config of configs) {
      if (config.webhookSecret && config.repositories) {
        const repos = typeof config.repositories === "string"
          ? JSON.parse(config.repositories)
          : config.repositories;
        // Assign the existing global webhookSecret to every repo
        const updated = repos.map((r) => ({
          ...r,
          webhookSecret: config.webhookSecret,
        }));
        await queryInterface.sequelize.query(
          `UPDATE github_configs SET repositories = :repos WHERE id = :id`,
          {
            replacements: { repos: JSON.stringify(updated), id: config.id },
          }
        );
      }
    }

    // Drop the old column
    await queryInterface.removeColumn("github_configs", "webhookSecret");
  },

  down: async (queryInterface, Sequelize) => {
    // Re-add the column
    await queryInterface.addColumn("github_configs", "webhookSecret", {
      type: Sequelize.BLOB,
      allowNull: true,
    });
  },
};
