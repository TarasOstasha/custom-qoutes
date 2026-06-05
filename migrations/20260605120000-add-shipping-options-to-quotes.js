"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("quotes", "shipping_options_json", {
      type: Sequelize.JSONB,
      allowNull: true,
    });
    await queryInterface.addColumn("quotes", "selected_shipping_value", {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("quotes", "selected_shipping_value");
    await queryInterface.removeColumn("quotes", "shipping_options_json");
  },
};
