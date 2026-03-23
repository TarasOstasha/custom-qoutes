import express from "express";
import quotesRouter from "./routes/quotes";

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/quotes", quotesRouter);

app.listen(port, () => {
  console.log(`Quote API running on http://localhost:${port}`);
});
