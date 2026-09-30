"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE SEQUENCE IF NOT EXISTS quote_number_seq
        AS integer
        START WITH 1
        INCREMENT BY 1
        MINVALUE 1
    `);
    await queryInterface.sequelize.query(`
      SELECT setval(
        'quote_number_seq',
        GREATEST(
          1,
          COALESCE((
            SELECT MAX(CAST(SUBSTRING(quote_number FROM 2) AS INTEGER))
            FROM quotes
            WHERE quote_number ~ '^Q[0-9]+$'
          ), 0)
        ),
        COALESCE((
          SELECT MAX(CAST(SUBSTRING(quote_number FROM 2) AS INTEGER))
          FROM quotes
          WHERE quote_number ~ '^Q[0-9]+$'
        ), 0) > 0
      )
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query("DROP SEQUENCE IF EXISTS quote_number_seq");
  },
};
