"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("test_results", "code_references", {
      type: Sequelize.JSONB,
      allowNull: true,
    }).catch(() => {});

    await queryInterface.addColumn("test_results", "srs_references", {
      type: Sequelize.JSONB,
      allowNull: true,
    }).catch(() => {});

    // Code side columns — để hiển thị cột "Code thực tế" không phải parse từ assertionLogic
    await queryInterface.addColumn("test_results", "code_actor", {
      type: Sequelize.STRING(255),
      allowNull: true,
    }).catch(() => {});

    await queryInterface.addColumn("test_results", "code_event", {
      type: Sequelize.TEXT,
      allowNull: true,
    }).catch(() => {});

    await queryInterface.addColumn("test_results", "code_action", {
      type: Sequelize.TEXT,
      allowNull: true,
    }).catch(() => {});

    await queryInterface.addColumn("test_results", "code_state", {
      type: Sequelize.TEXT,
      allowNull: true,
    }).catch(() => {});

    await queryInterface.addColumn("test_results", "code_guard", {
      type: Sequelize.TEXT,
      allowNull: true,
    }).catch(() => {});

    // SRS side columns — để hiển thị cột "SRS mô tả" có cấu trúc
    await queryInterface.addColumn("test_results", "srs_actor", {
      type: Sequelize.STRING(255),
      allowNull: true,
    }).catch(() => {});

    await queryInterface.addColumn("test_results", "srs_event", {
      type: Sequelize.TEXT,
      allowNull: true,
    }).catch(() => {});

    await queryInterface.addColumn("test_results", "srs_action", {
      type: Sequelize.TEXT,
      allowNull: true,
    }).catch(() => {});

    await queryInterface.addColumn("test_results", "srs_state", {
      type: Sequelize.TEXT,
      allowNull: true,
    }).catch(() => {});

    await queryInterface.addColumn("test_results", "srs_guard_br", {
      type: Sequelize.TEXT,
      allowNull: true,
    }).catch(() => {});

    await queryInterface.addColumn("test_results", "step_number", {
      type: Sequelize.INTEGER,
      allowNull: true,
    }).catch(() => {});
  },

  async down(queryInterface) {
    const cols = [
      "code_references", "srs_references",
      "code_actor", "code_event", "code_action", "code_state", "code_guard",
      "srs_actor", "srs_event", "srs_action", "srs_state", "srs_guard_br",
      "step_number",
    ];
    for (const c of cols) {
      await queryInterface.removeColumn("test_results", c).catch(() => {});
    }
  },
};
