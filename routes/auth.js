const express = require('express');
const db = require('../config/database');
const router = express.Router();

// Login endpoint
router.post('/login', (req, res) => {
  const { password } = req.body || {};
  const system = db.load().system;

  console.log('🔐 Login attempt received');

  // Simple cookie settings that work everywhere
  const cookieOptions = {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: false,
    maxAge: 365 * 24 * 60 * 60 * 1000 // 1 year
  };

  if (password === system.password) {
    console.log('✅ Login successful');
    res.cookie('auth', '1', cookieOptions);
    return res.json({ 
      ok: true, 
      message: 'Login successful'
    });
  }

  console.log('❌ Login failed - wrong password');
  return res.status(401).json({ 
    error: 'Wrong password',
    code: 'WRONG_PASSWORD'
  });
});

// Logout endpoint
router.post('/logout', (req, res) => {
  res.clearCookie('auth');
  res.json({ ok: true, message: 'Logged out' });
});

// Check auth status
router.get('/check', (req, res) => {
  res.json({ 
    authenticated: req.cookies.auth === '1'
  });
});

module.exports = router;
