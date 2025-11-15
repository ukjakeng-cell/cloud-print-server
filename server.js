// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pool from "./db.js";
import { v4 as uuidv4 } from "uuid";
import qrcode from "qrcode";
import { ClerkExpressRequireAuth } from "@clerk/clerk-sdk-node";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// health
app.get("/", (req, res) => res.send("Cloud Print Server Running"));

// create print job (protected: user must be logged in via Clerk)
// client should have uploaded file to cloud (Cloudinary/S3) and send fileUrl
app.post("/create-job", ClerkExpressRequireAuth(), async (req, res) => {
  try {
    const userId = req.auth.userId;
    const { fileUrl, fileName, totalPages = 1, color = false, duplex = false, copies = 1, printer_id = null } = req.body;
    if (!fileUrl) return res.status(400).json({ error: "fileUrl required" });

    const insertSql = `
      INSERT INTO print_jobs (user_id, file_url, file_name, total_pages, color, duplex, copies, printer_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id, user_id, file_url, status, created_at
    `;
    const values = [userId, fileUrl, fileName || null, totalPages, color, duplex, copies, printer_id];
    const result = await pool.query(insertSql, values);
    const job = result.rows[0];

    // create QR session for this job (expires in e.g. 10 minutes)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    const createQrSql = `INSERT INTO qr_sessions (job_id, user_id, expires_at) VALUES ($1,$2,$3) RETURNING qr_id`;
    const qrRes = await pool.query(createQrSql, [job.id, userId, expiresAt]);
    const qrId = qrRes.rows[0].qr_id;

    // generate QR as Data URL containing qrId (printer will POST it)
    const qrData = qrId; // you may include more info, but keep token small
    const qrDataUrl = await qrcode.toDataURL(qrData);

    res.json({
      ok: true,
      job,
      qr: {
        qr_id: qrId,
        expires_at: expiresAt,
        qr_data_url: qrDataUrl
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "create job failed" });
  }
});

// Printer agent scans QR (sends qr_id) -> server returns job details if valid
// This endpoint is not protected by Clerk because printer is a device
app.post("/printer/scan-qr", async (req, res) => {
  try {
    const { qr_id } = req.body;
    if (!qr_id) return res.status(400).json({ error: "qr_id required" });

    // find session
    const qrSql = `SELECT job_id, expires_at FROM qr_sessions WHERE qr_id = $1`;
    const qrRes = await pool.query(qrSql, [qr_id]);
    if (!qrRes.rows.length) return res.status(404).json({ error: "QR not found" });

    const { job_id, expires_at } = qrRes.rows[0];
    if (new Date() > new Date(expires_at)) {
      return res.status(410).json({ error: "QR expired" });
    }

    // fetch job
    const jobSql = `SELECT id, user_id, file_url, file_name, total_pages, color, duplex, copies, status FROM print_jobs WHERE id=$1`;
    const jobRes = await pool.query(jobSql, [job_id]);
    if (!jobRes.rows.length) return res.status(404).json({ error: "Job not found" });

    const job = jobRes.rows[0];

    // optional: check if payment required, etc.
    // if job.status !== 'paid' -> tell printer to request payment flow or block
    res.json({ ok: true, job });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "scan handler failed" });
  }
});

// Printer reports printing complete
app.post("/printer/complete", async (req, res) => {
  try {
    const { job_id, status = "done" } = req.body;
    if (!job_id) return res.status(400).json({ error: "job_id required" });

    await pool.query(`UPDATE print_jobs SET status=$1, updated_at=NOW() WHERE id=$2`, [status, job_id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "complete failed" });
  }
});

// Payment webhook placeholder (e.g., KPay / Stripe will call here)
app.post("/payment/webhook", async (req, res) => {
  // Validate signature according to provider
  // Example payload: { job_id, status: 'success', transaction_id, amount, method }
  try {
    const { job_id, status, transaction_id, amount, method, user_id } = req.body;
    if (!job_id) return res.status(400).send("missing job_id");

    await pool.query(
      `INSERT INTO payments (user_id, job_id, method, amount, status, transaction_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [user_id || null, job_id, method || "unknown", amount || 0, status || "pending", transaction_id || null]
    );

    if (status === "success") {
      await pool.query(`UPDATE print_jobs SET status='paid' WHERE id=$1`, [job_id]);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "webhook failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on ${PORT}`));
