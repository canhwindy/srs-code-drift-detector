"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // Create table only if it doesn't exist
    const tableExists = await queryInterface.tableExists("claude_credentials");

    if (!tableExists) {
      await queryInterface.createTable("claude_credentials", {
        id: {
          type: Sequelize.STRING(36),
          primaryKey: true,
          allowNull: false,
        },
        user_key: {
          type: Sequelize.STRING(64),
          allowNull: false,
          unique: true,
          index: true,
        },
        credentials_encrypted: {
          type: Sequelize.TEXT,
          allowNull: false,
        },
        expires_at_ms: {
          type: Sequelize.BIGINT,
          allowNull: false,
        },
        subscription_type: {
          type: Sequelize.STRING(32),
          allowNull: true,
        },
        token_type: {
          type: Sequelize.ENUM("oauth_with_refresh", "access_token_only", "api_key"),
          allowNull: false,
          defaultValue: "oauth_with_refresh",
        },
        auto_refresh_enabled: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        credential_metadata: {
          type: Sequelize.JSON,
          allowNull: false,
          defaultValue: {},
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("NOW()"),
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("NOW()"),
        },
      });
    }
  },

  async down(queryInterface) {
    const tableExists = await queryInterface.tableExists("claude_credentials");
    if (tableExists) {
      await queryInterface.dropTable("claude_credentials");
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_claude_credentials_token_type";'
      );
    }
  },
};
