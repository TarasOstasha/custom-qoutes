import dotenv from "dotenv";
dotenv.config();
import express from "express";
import quotesRouter from "./routes/quotes";
import cors from "cors";

const app = express();
const port = Number(process.env.PORT ?? 5000);

const corsOPtions = {
  origin: '*'
}

app.use(cors(corsOPtions));

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/quotes", quotesRouter);

app.listen(port, () => {
  console.log(`Quote API running on http://localhost:${port}`);
});
