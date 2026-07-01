import { DataTypes, InferAttributes, InferCreationAttributes, Model, CreationOptional } from "sequelize";
import { getActiveSequelize } from "../sequelize";

export class QuoteItem extends Model<InferAttributes<QuoteItem>, InferCreationAttributes<QuoteItem>> {
  declare id: CreationOptional<string>;
  declare quoteId: string;
  declare productCode: string | null;
  declare description: string | null;
  declare optionalDescription: string | null;
  declare qty: number | null;
  declare unitPrice: string | null;
  declare amount: string | null;
  declare optionsJson: object | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

QuoteItem.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    quoteId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "quote_id",
    },
    productCode: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "product_code",
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    optionalDescription: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "optional_description",
    },
    qty: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    unitPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "unit_price",
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    optionsJson: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "options_json",
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "created_at",
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "updated_at",
    },
  },
  {
    sequelize: getActiveSequelize(),
    modelName: "QuoteItem",
    tableName: "quote_items",
    underscored: true,
    timestamps: true,
  },
);
