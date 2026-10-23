"use strict";

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn("documents", "status", {
            type: Sequelize.STRING(20),
            allowNull: false,
            defaultValue: "In Progress",
        });
    },
    async down(queryInterface) {
        await queryInterface.removeColumn("documents", "status");
    },
};
