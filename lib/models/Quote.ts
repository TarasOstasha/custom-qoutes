import { DataTypes, InferAttributes, InferCreationAttributes, Model, CreationOptional } from "sequelize";
import { getActiveSequelize } from "../sequelize";

export class Quote extends Model<InferAttributes<Quote>, InferCreationAttributes<Quote>> {
  declare id: CreationOptional<string>;
  declare quoteNumber: string;
  declare quoteDate: string | null;
  declare status: CreationOptional<string>;
  declare version: CreationOptional<string>;
  declare customerName: string | null;
  declare customerId: string | null;
  declare company: string | null;
  declare email: string | null;
  declare phone: string | null;
  declare address: string | null;
  declare notes: string | null;
  declare internalNotes: string | null;
  declare estimateValidDays: CreationOptional<number | null>;
  declare salesContact: string | null;
  declare abandonedCartId: string | null;
  declare abandonedCartLinesJson: unknown | null;
  declare internalAttachmentsJson: unknown | null;
  declare subtotal: string | null;
  declare shipping: string | null;
  declare shippingLabel: string | null;
  declare shippingMethod: string | null;
  declare shippingState: string | null;
  declare shippingZip: string | null;
  declare shippingOptionsJson: unknown | null;
  declare selectedShippingValue: string | null;
  declare taxRate: string | null;
  declare taxAmount: string | null;
  declare taxLabel: string | null;
  declare taxDescription: string | null;
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
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "1",
    },
    customerName: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "customer_name",
    },
    customerId: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "customer_id",
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
    internalNotes: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "internal_notes",
    },
    estimateValidDays: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 30,
      field: "estimate_valid_days",
    },
    salesContact: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "sales_contact",
    },
    abandonedCartId: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "abandoned_cart_id",
    },
    abandonedCartLinesJson: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "abandoned_cart_lines_json",
    },
    internalAttachmentsJson: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "internal_attachments_json",
    },
    subtotal: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    shipping: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    shippingLabel: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "shipping_label",
    },
    shippingMethod: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "shipping_method",
    },
    shippingState: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "shipping_state",
    },
    shippingZip: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "shipping_zip",
    },
    shippingOptionsJson: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "shipping_options_json",
    },
    selectedShippingValue: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "selected_shipping_value",
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
    taxLabel: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "tax_label",
    },
    taxDescription: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "tax_description",
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
    sequelize: getActiveSequelize(),
    modelName: "Quote",
    tableName: "quotes",
    underscored: true,
    timestamps: true,
  },
);
