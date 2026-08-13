const express = require('express');
const { getAuthUrl, exchangeCode } = require('../googleAuth');
const { db } = require('../db');

const router = express.Router();

router.get('/google', (req, res) => {
  try {
    res.redirect(getAuthUrl());
  } catch (err) {
    res.status(500).send(`Google sign-in isn't configured yet: ${err.message}`);
  }
});

router.get('/google/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    if (error) throw new Error(error);
    const { email, refreshToken } = await exchangeCode(code);
    await db.execute({
      sql: 'INSERT INTO oauth_tokens (google_email, refresh_token, connected_at) VALUES (?, ?, ?)',
      args: [email, refreshToken, new Date().toISOString()]
    });
    res.redirect('/?connected=' + encodeURIComponent(email));
  } catch (err) {
    res.status(500).send(`Google sign-in failed: ${err.message}`);
  }
});

module.exports = router;
