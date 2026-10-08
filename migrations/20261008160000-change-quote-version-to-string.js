"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn("quotes", "version", {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: "1",
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn("quotes", "version", {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1,
    });
  },
};
