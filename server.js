import express from "express";
import cors from "cors";
import pool from "./db.js";
import { ClerkExpressRequireAuth } from '@clerk/clerk-sdk-node';

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Cloud Print Server Running!");
});

// DB 測試
app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ server: "OK", time: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB connection failed" });
  }
});

app.listen(3000, () => {
  console.log("Server started at http://localhost:3000");
});

app.get('/me', ClerkExpressRequireAuth(), (req, res) => {
  const userId = req.auth.userId;
  res.json({ authenticated: true, userId });
});