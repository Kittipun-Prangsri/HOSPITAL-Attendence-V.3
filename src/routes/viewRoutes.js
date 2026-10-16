const express = require('express');
const router = express.Router();
const { checkAuth, checkAdmin, checkSuper } = require('../middleware/auth');
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
  { path: '/flex-preview', view: 'flex-preview' }
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

  if (superPaths.includes(p.path)) {
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

module.exports = router;
