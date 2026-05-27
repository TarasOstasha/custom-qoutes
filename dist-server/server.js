"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const quotes_1 = __importDefault(require("./routes/quotes"));
const cors_1 = __importDefault(require("cors"));
const scrapeStorefrontCart_1 = require("./services/scrapeStorefrontCart");
const models_1 = require("./lib/models");
if (process.env.NODE_ENV !== "production") {
    try {
        require("dotenv").config();
    }
    catch { }
}
const app = (0, express_1.default)();
const port = Number(process.env.PORT ?? 5000);
const corsOPtions = {
    origin: '*'
};
app.use((0, cors_1.default)(corsOPtions));
app.use(express_1.default.json());
models_1.sequelize
    .authenticate()
    .then(() => {
    console.log("Connected to PostgreSQL via Sequelize");
})
    .catch((error) => {
    console.error("Failed to connect to PostgreSQL:", error);
});
app.get("/health", (_req, res) => {
    res.json({ ok: true });
});
app.post("/api/cart/open-session", async (_req, res) => {
    try {
        const result = await (0, scrapeStorefrontCart_1.openVisibleVolusionHomepageSession)();
        return res.json(result);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to open live website session";
        return res.status(500).json({ error: message });
    }
});
app.use("/api/quotes", quotes_1.default);
app.use("/quotes", quotes_1.default);
app.listen(port, () => {
    console.log(`Quote API running on http://localhost:${port}`);
});
