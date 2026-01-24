const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { query } = require("../db");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
};

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ ok: false, error: "Missing credentials" });
    }

    const { rows } = await query(
      `
        SELECT id, username, display_name, password_hash, is_active, role_id
        FROM staff_users
        WHERE username = $1
        LIMIT 1
      `,
      [username]
    );

    const user = rows[0];
    const passwordOk = user ? await bcrypt.compare(password, user.password_hash) : false;

    if (!user || !user.is_active || !passwordOk) {
      if (user) {
        await query(
          `
            UPDATE staff_users
            SET failed_login_count = failed_login_count + 1,
                updated_at = now()
            WHERE id = $1
          `,
          [user.id]
        );
      }

      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    await query(
      `
        UPDATE staff_users
        SET failed_login_count = 0,
            last_login_at = now(),
            updated_at = now()
        WHERE id = $1
      `,
      [user.id]
    );

    const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.cookie("token", token, cookieOptions);
    return res.json({
      ok: true,
      data: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
      },
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  return res.json({ ok: true, data: req.user });
});

router.post("/logout", (req, res) => {
  res.clearCookie("token", cookieOptions);
  return res.json({ ok: true, data: { message: "Logged out" } });
});

module.exports = router;
