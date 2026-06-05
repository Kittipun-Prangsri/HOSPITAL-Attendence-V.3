const express = require('express');
const router = express.Router();
const { checkAuth, checkAdmin, checkSuper } = require('../middleware/auth');
const { DEPARTMENTS } = require('../constants/departments');

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
  { path: '/excuses', view: 'excuses' }
];

pages.forEach(p => {
  const adminPaths = [
    '/attendance', '/personnel', '/scheduling', '/reports', 
    '/report/daily', '/report/monthly', '/report/hours'
  ];
  const superPaths = [
    '/admin/users', '/admin/permissions', '/permissions'
  ];
  const isDept = p.path.startsWith('/department/');

  if (superPaths.includes(p.path)) {
    router.get(p.path, checkAuth, checkSuper, (req, res) => {
      res.render(p.view, { activeRoute: p.path, deptName: p.deptName || '' });
    });
  } else if (adminPaths.includes(p.path) || isDept) {
    router.get(p.path, checkAuth, checkAdmin, (req, res) => {
      res.render(p.view, { activeRoute: p.path, deptName: p.deptName || '' });
    });
  } else {
    router.get(p.path, checkAuth, (req, res) => {
      res.render(p.view, { activeRoute: p.path, deptName: p.deptName || '' });
    });
  }
});

module.exports = router;
