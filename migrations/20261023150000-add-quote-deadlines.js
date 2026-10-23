"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("quotes", "delivery_deadline", {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn("quotes", "art_deadline", {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("quotes", "art_deadline");
    await queryInterface.removeColumn("quotes", "delivery_deadline");
  },
};
