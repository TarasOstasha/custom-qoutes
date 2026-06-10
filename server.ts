import express from "express";
import { DataTypes } from "sequelize";
import quotesRouter from "./routes/quotes";
import uploadImageRouter from "./routes/uploadImage";
import cors from "cors";
import { openVisibleVolusionCartSession, openVisibleVolusionHomepageSession } from "./services/scrapeStorefrontCart";
import { sequelize } from "./lib/models";
import { getUploadsDir } from "./lib/uploadsDir";

if (process.env.NODE_ENV !== "production") {
  try {
    require("dotenv").config();
  } catch {}
}

const app = express();
const port = Number(process.env.PORT ?? 5000);

async function ensureQuotePersistenceColumns(): Promise<void> {
  const qi = sequelize.getQueryInterface();
  const table = await qi.describeTable("quotes");
  type AddColumnSpec = Parameters<typeof qi.addColumn>[2];
  const addIfMissing = async (
    column: string,
    spec: AddColumnSpec,
  ) => {
    if (!table[column]) {
      await qi.addColumn("quotes", column, spec);
    }
  };

  await addIfMissing("shipping_label", { type: DataTypes.STRING, allowNull: true });
  await addIfMissing("shipping_method", { type: DataTypes.STRING, allowNull: true });
  await addIfMissing("shipping_state", { type: DataTypes.STRING, allowNull: true });
  await addIfMissing("shipping_zip", { type: DataTypes.STRING, allowNull: true });
  await addIfMissing("tax_label", { type: DataTypes.STRING, allowNull: true });
  await addIfMissing("tax_description", { type: DataTypes.STRING, allowNull: true });
}

const corsOPtions = {
  origin: '*'
}

app.use(cors(corsOPtions));

app.use(express.json());

sequelize
  .authenticate()
  .then(async () => {
    await ensureQuotePersistenceColumns();
    console.log("Connected to PostgreSQL via Sequelize");
  })
  .catch((error: unknown) => {
    console.error("Failed to connect to PostgreSQL:", error);
  });

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/cart/open-session", async (_req, res) => {
  try {
    const result = await openVisibleVolusionHomepageSession();
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to open live website session";
    return res.status(500).json({ error: message });
  }
});

app.post("/api/cart/open-cart", async (_req, res) => {
  try {
    const result = await openVisibleVolusionCartSession();
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to open cart in live session";
    return res.status(500).json({ error: message });
  }
});

app.use("/api/uploads", express.static(getUploadsDir()));
app.use("/api/upload-image", uploadImageRouter);

app.use("/api/quotes", quotesRouter);
app.use("/quotes", quotesRouter);

app.listen(port, () => {
  console.log(`Quote API running on http://localhost:${port}`);
});
