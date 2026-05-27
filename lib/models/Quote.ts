import { DataTypes, InferAttributes, InferCreationAttributes, Model, CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export class Quote extends Model<InferAttributes<Quote>, InferCreationAttributes<Quote>> {
  declare id: CreationOptional<string>;
  declare quoteNumber: string;
  declare quoteDate: string | null;
  declare status: CreationOptional<string>;
  declare version: CreationOptional<number>;
  declare customerName: string | null;
  declare company: string | null;
  declare email: string | null;
  declare phone: string | null;
  declare address: string | null;
  declare notes: string | null;
  declare subtotal: string | null;
  declare shipping: string | null;
  declare taxRate: string | null;
  declare taxAmount: string | null;
  declare total: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Quote.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    quoteNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      field: "quote_number",
    },
    quoteDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      field: "quote_date",
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "draft",
    },
    version: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    customerName: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "customer_name",
    },
    company: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    subtotal: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    shipping: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    taxRate: {
      type: DataTypes.DECIMAL(5, 3),
      allowNull: true,
      field: "tax_rate",
    },
    taxAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "tax_amount",
    },
    total: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
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
    sequelize,
    modelName: "Quote",
    tableName: "quotes",
    underscored: true,
    timestamps: true,
  },
);
