const db = require('../config/database');

function requireAuth(req, res, next) {
  if (req.cookies.auth === '1') {
    return next();
  }
  
  return res.status(401).json({ 
    error: 'Authentication required',
    code: 'UNAUTHORIZED'
  });
}

function checkAuth(req, res, next) {
  res.locals.authenticated = req.cookies.auth === '1';
  next();
}

module.exports = {
  requireAuth,
  checkAuth
};
