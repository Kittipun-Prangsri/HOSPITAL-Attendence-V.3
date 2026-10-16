const RBAC_ENABLED = true;

const isApiRequest = req => (req.originalUrl || '').startsWith('/api/') || req.xhr ||
  Boolean(req.headers.accept && req.headers.accept.includes('json'));

const checkAuth = (req, res, next) => {
  if (req.session.user) {
    res.locals.user = req.session.user; // Make user data available in EJS
    res.locals.RBAC_ENABLED = RBAC_ENABLED; // Expose to EJS views
    next();
  } else if (isApiRequest(req)) {
    res.status(401).json({ success: false, error: 'กรุณาเข้าสู่ระบบใหม่', loginRequired: true });
  } else {
    res.redirect('/login');
  }
};

const checkAdmin = (req, res, next) => {
  if (!RBAC_ENABLED) return next();
  
  if (req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'super')) {
    next();
  } else if (isApiRequest(req)) {
    res.status(403).json({ success: false, error: 'เข้าถึงไม่ได้: เฉพาะผู้ดูแลระบบเท่านั้น' });
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
    if (isApiRequest(req)) {
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
