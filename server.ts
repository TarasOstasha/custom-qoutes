import express from "express";
import quotesRouter from "./routes/quotes";
import cors from "cors";
import { openVisibleVolusionHomepageSession } from "./services/scrapeStorefrontCart";
import { sequelize } from "./lib/models";

if (process.env.NODE_ENV !== "production") {
  try {
    require("dotenv").config();
  } catch {}
}

const app = express();
const port = Number(process.env.PORT ?? 5000);

const corsOPtions = {
  origin: '*'
}

app.use(cors(corsOPtions));

app.use(express.json());

sequelize
  .authenticate()
  .then(() => {
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

app.use("/api/quotes", quotesRouter);
app.use("/quotes", quotesRouter);

app.listen(port, () => {
  console.log(`Quote API running on http://localhost:${port}`);
});
