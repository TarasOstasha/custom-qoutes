"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("quotes", "estimate_valid_days", {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: 30,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("quotes", "estimate_valid_days");
  },
};
