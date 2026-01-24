const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const dotenv = require("dotenv");

dotenv.config();

const authRoutes = require("./routes/auth");

const app = express();
const port = process.env.PORT || 3001;

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (req, res) => {
  res.json({ ok: true, data: { status: "ok" } });
});

app.use("/api/auth", authRoutes);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

app.use((err, req, res, next) => {
  res.status(500).json({ ok: false, error: "Server error" });
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
