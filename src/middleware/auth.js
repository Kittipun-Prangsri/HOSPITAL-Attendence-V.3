const RBAC_ENABLED = true;

const checkAuth = (req, res, next) => {
  if (req.session.user) {
    res.locals.user = req.session.user; // Make user data available in EJS
    res.locals.RBAC_ENABLED = RBAC_ENABLED; // Expose to EJS views
    next();
  } else {
    res.redirect('/login');
  }
};

const checkAdmin = (req, res, next) => {
  if (!RBAC_ENABLED) return next();
  
  if (req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'super')) {
    next();
  } else {
    res.send(`<script>alert('พื้นที่เฉพาะผู้ดูแลระบบเท่านั้น'); window.location.href='/';</script>`);
  }
};

module.exports = {
  checkAuth,
  checkAdmin,
  RBAC_ENABLED
};
