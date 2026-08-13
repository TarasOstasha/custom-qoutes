require("./lib/playwrightSetup");

import type { Express, Request, Response } from "express";
import type { DataTypes as DataTypesType } from "sequelize";

let apiReady = false;

async function initializeRoutes(app: Express): Promise<void> {
  const { resolveDatabaseUrl } = require("./lib/resolveDatabaseUrl") as typeof import("./lib/resolveDatabaseUrl");
  const { DataTypes } = require("sequelize") as { DataTypes: typeof DataTypesType };
  const quotesRouter = require("./routes/quotes").default as Express;
  const uploadImageRouter = require("./routes/uploadImage").default as Express;
  const {
    openVisibleVolusionCartSession,
    openVisibleVolusionHomepageSession,
  } = require("./services/scrapeStorefrontCart") as typeof import("./services/scrapeStorefrontCart");
  const { getActiveSequelize } = require("./lib/models") as typeof import("./lib/models");
  const { getUploadsDir } = require("./lib/uploadsDir") as typeof import("./lib/uploadsDir");
  const { refreshOfficePersistenceStatus } = require("./lib/officePersistence") as typeof import("./lib/officePersistence");
  const express = require("express") as typeof import("express");

  await resolveDatabaseUrl();

  const sequelize = getActiveSequelize();

  async function ensureQuotePersistenceColumns(): Promise<void> {
    const qi = sequelize.getQueryInterface();
    const table = await qi.describeTable("quotes");
    type AddColumnSpec = Parameters<typeof qi.addColumn>[2];
    const addIfMissing = async (column: string, spec: AddColumnSpec) => {
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

  sequelize
    .authenticate()
    .then(async () => {
      await ensureQuotePersistenceColumns();
      console.log("Connected to PostgreSQL via Sequelize");
    })
    .catch((error: unknown) => {
      console.error("Failed to connect to PostgreSQL:", error);
    });

  const persistenceAvailable = await refreshOfficePersistenceStatus();
  console.log(
    persistenceAvailable
      ? "Database persistence is available — quotes will be saved."
      : "Database persistence is unavailable — quotes will not be saved.",
  );

  app.post("/api/cart/open-session", async (_req: Request, res: Response) => {
    try {
      const result = await openVisibleVolusionHomepageSession();
      return res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open live website session";
      return res.status(500).json({ error: message });
    }
  });

  app.post("/api/cart/open-cart", async (_req: Request, res: Response) => {
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

  apiReady = true;
}

async function bootstrap(): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    try {
      require("dotenv").config();
    } catch {}
  }

  const express = require("express") as typeof import("express");
  const cors = require("cors") as typeof import("cors");
  const app = express();
  const port = Number(process.env.API_PORT ?? process.env.PORT ?? 5100);

  app.use(cors({ origin: "*" }));
  app.use(express.json());

  app.get("/health", async (req: Request, res: Response) => {
    if (!apiReady) {
      res.json({ ok: true, persistenceAvailable: false, starting: true });
      return;
    }

    const { isOfficePersistenceAvailable } = require("./lib/officePersistence") as typeof import("./lib/officePersistence");
    const { refreshDatabaseConnection } = require("./lib/reconnectDatabase") as typeof import("./lib/reconnectDatabase");

    const force = String(req.query.force ?? "") === "1";
    if (force) {
      await refreshDatabaseConnection();
    }
    const available = await isOfficePersistenceAvailable(force);
    res.json({ ok: true, persistenceAvailable: available });
  });

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`Quote API running on http://localhost:${port}`);
      resolve();
    });
    server.on("error", reject);
  });

  void initializeRoutes(app).catch((error: unknown) => {
    console.error("Failed to initialize API routes:", error);
  });
}

void bootstrap().catch((error: unknown) => {
  console.error("Failed to start Quote API:", error);
  process.exit(1);
});
