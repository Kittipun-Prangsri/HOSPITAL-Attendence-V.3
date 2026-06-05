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

const checkSuper = (req, res, next) => {
  if (!RBAC_ENABLED) return next();
  
  if (req.session.user && req.session.user.role === 'super') {
    next();
  } else {
    // If it's an AJAX or API request, return JSON 403
    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
      return res.status(403).json({ success: false, error: 'เข้าถึงไม่ได้: สิทธิ์การเข้าถึงระดับ Super Admin เท่านั้น' });
    }
    // If it's a page navigation, display alert and redirect to home
    res.send(`<script>alert('พื้นที่เฉพาะผู้ดูแลระบบระดับสูง (Super Admin) เท่านั้น'); window.location.href='/';</script>`);
  }
};

module.exports = {
  checkAuth,
  checkAdmin,
  checkSuper,
  RBAC_ENABLED
};
