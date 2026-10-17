const express = require('express');
const router = express.Router();
const { checkAuth, checkAdmin, checkSuper, checkReviewer } = require('../middleware/auth');
const { DEPARTMENTS } = require('../constants/departments');
const { NAV_SECTIONS, canAccess, findNavItem, isActive } = require('../constants/navigation');

const pages = [
  { path: '/', view: 'index' },
  { path: '/attendance', view: 'attendance' },
  { path: '/personnel', view: 'personnel' },
  { path: '/schedule', view: 'schedule' },
  { path: '/scheduling', view: 'scheduling' },
  { path: '/reports', view: 'reports' },
  ...DEPARTMENTS.map(d => ({ path: `/department/${d.id}`, view: 'department', deptName: d.name })),
  { path: '/report/daily', view: 'daily-report' },
  { path: '/report/monthly', view: 'monthly-report' },
  { path: '/report/hours', view: 'hours-summary' },
  { path: '/admin/users', view: 'users' },
  { path: '/admin/permissions', view: 'permissions' },
  { path: '/excuses', view: 'excuses' },
  { path: '/leave', view: 'leave' },
  { path: '/ot', view: 'ot' },
  { path: '/admin/calendar', view: 'calendar' },
  { path: '/admin/audit', view: 'audit' },
  { path: '/departments', view: 'departments', departments: DEPARTMENTS },
  { path: '/flex-preview', view: 'flex-preview' },
  { path: '/admin/face', view: 'face-admin' }
];

const viewLocals = p => ({
  activeRoute: p.path,
  deptName: p.deptName || '',
  NAV_SECTIONS,
  navCanAccess: canAccess,
  navIsActive: isActive,
  departments: p.departments || DEPARTMENTS,
  navMatch: findNavItem(p.path)
});

pages.forEach(p => {
  const adminPaths = [
    '/attendance', '/personnel', '/scheduling', '/reports', 
    '/report/daily', '/report/monthly', '/report/hours', '/departments', '/admin/calendar'
  ];
  const superPaths = [
    '/admin/users', '/admin/permissions', '/permissions', '/admin/audit'
  ];
  const isDept = p.path.startsWith('/department/');

  if (p.path === '/admin/face') {
    router.get(p.path, checkAuth, checkReviewer, (req, res) => res.render(p.view, viewLocals(p)));
  } else if (superPaths.includes(p.path)) {
    router.get(p.path, checkAuth, checkSuper, (req, res) => {
      res.render(p.view, viewLocals(p));
    });
  } else if (adminPaths.includes(p.path) || isDept) {
    router.get(p.path, checkAuth, checkAdmin, (req, res) => {
      res.render(p.view, viewLocals(p));
    });
  } else {
    router.get(p.path, checkAuth, (req, res) => {
      res.render(p.view, viewLocals(p));
    });
  }
});

// Mobile face-scan page, opened from LINE (LIFF). No checkAuth: inside LINE it signs in with the
// LIFF ID token itself; in a normal browser without a session it sends the user to /login.
router.get('/m/face', (req, res) => {
  if (req.session.user) res.locals.user = req.session.user;
  res.render('mobile-face', { liffId: process.env.LIFF_ID || '' });
});

module.exports = router;
