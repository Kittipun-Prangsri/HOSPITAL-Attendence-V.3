const RBAC_ENABLED = true;

const isApiRequest = req => (req.originalUrl || '').startsWith('/api/') || req.xhr ||
  Boolean(req.headers.accept && req.headers.accept.includes('json'));

/** Only same-site paths: "/schedule" yes; "//evil.com", "/\\evil.com", absolute URLs and /api no. */
const safeReturnTo = url => (typeof url === 'string' && url.length <= 300 && /^\/(?![\/\\])/.test(url) &&
  !url.startsWith('/api/') && !url.startsWith('/login') ? url : null);

const checkAuth = (req, res, next) => {
  if (req.session.user) {
    res.locals.user = req.session.user; // Make user data available in EJS
    res.locals.RBAC_ENABLED = RBAC_ENABLED; // Expose to EJS views
    const u = req.session.user;
    if (u.role === 'admin' || u.role === 'super') {
      // Admin accounts without a second factor may only reach the security page until they add one
      return require('../services/mfa').needsSetup(u).then(needs => {
        const path = req.originalUrl || '';
        const allowed = path.startsWith('/security') || path.startsWith('/api/me/') || path.startsWith('/api/notifications/inbox');
        if (!needs || allowed) return next();
        if (isApiRequest(req)) return res.status(403).json({ success: false, error: 'กรุณาตั้งค่าการยืนยันตัวตน 2 ขั้นก่อน', mfaSetup: true });
        return res.redirect('/security');
      }).catch(() => next());
    }
    // Department heads get review screens for their departments (lookup is cached for a minute)
    require('../services/reviewScope').reviewScope(u)
      .then(scope => { res.locals.isHead = Boolean(scope); })
      .catch(() => { res.locals.isHead = false; })
      .finally(() => next());
  } else if (isApiRequest(req)) {
    res.status(401).json({ success: false, error: 'กรุณาเข้าสู่ระบบใหม่', loginRequired: true });
  } else {
    // Deep links (LINE rich menu → /schedule, /leave) land on the page after signing in, not the dashboard
    const back = req.method === 'GET' ? safeReturnTo(req.originalUrl) : null;
    if (back && back !== '/') {
      req.session.returnTo = back;
      // Persist before redirecting, or a fast POST /login can read the session before it is stored
      return req.session.save(() => res.redirect('/login'));
    }
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

/** Admins, or department heads (set by checkAuth). Use after checkAuth. */
const checkReviewer = (req, res, next) => {
  const u = req.session.user;
  if (u && (u.role === 'admin' || u.role === 'super' || res.locals.isHead)) return next();
  if (isApiRequest(req)) return res.status(403).json({ success: false, error: 'สิทธิ์ไม่เพียงพอ' });
  return res.redirect('/');
};

module.exports = {
  checkReviewer,
  safeReturnTo,
  checkAuth,
  checkAdmin,
  checkSuper,
  RBAC_ENABLED
};
