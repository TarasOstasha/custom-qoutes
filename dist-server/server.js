"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const sequelize_1 = require("sequelize");
const quotes_1 = __importDefault(require("./routes/quotes"));
const uploadImage_1 = __importDefault(require("./routes/uploadImage"));
const cors_1 = __importDefault(require("cors"));
const scrapeStorefrontCart_1 = require("./services/scrapeStorefrontCart");
const models_1 = require("./lib/models");
const uploadsDir_1 = require("./lib/uploadsDir");
if (process.env.NODE_ENV !== "production") {
    try {
        require("dotenv").config();
    }
    catch { }
}
const app = (0, express_1.default)();
const port = Number(process.env.PORT ?? 5000);
async function ensureQuotePersistenceColumns() {
    const qi = models_1.sequelize.getQueryInterface();
    const table = await qi.describeTable("quotes");
    const addIfMissing = async (column, spec) => {
        if (!table[column]) {
            await qi.addColumn("quotes", column, spec);
        }
    };
    await addIfMissing("shipping_label", { type: sequelize_1.DataTypes.STRING, allowNull: true });
    await addIfMissing("shipping_state", { type: sequelize_1.DataTypes.STRING, allowNull: true });
    await addIfMissing("shipping_zip", { type: sequelize_1.DataTypes.STRING, allowNull: true });
    await addIfMissing("tax_label", { type: sequelize_1.DataTypes.STRING, allowNull: true });
    await addIfMissing("tax_description", { type: sequelize_1.DataTypes.STRING, allowNull: true });
}
const corsOPtions = {
    origin: '*'
};
app.use((0, cors_1.default)(corsOPtions));
app.use(express_1.default.json());
models_1.sequelize
    .authenticate()
    .then(async () => {
    await ensureQuotePersistenceColumns();
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
app.post("/api/cart/open-cart", async (_req, res) => {
    try {
        const result = await (0, scrapeStorefrontCart_1.openVisibleVolusionCartSession)();
        return res.json(result);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to open cart in live session";
        return res.status(500).json({ error: message });
    }
});
app.use("/api/uploads", express_1.default.static((0, uploadsDir_1.getUploadsDir)()));
app.use("/api/upload-image", uploadImage_1.default);
app.use("/api/quotes", quotes_1.default);
app.use("/quotes", quotes_1.default);
app.listen(port, () => {
    console.log(`Quote API running on http://localhost:${port}`);
});
