const express = require('express');
const router = express.Router();
const { checkAuth, checkAdmin, checkSuper } = require('../middleware/auth');
const apiController = require('../controllers/apiController');
const userController = require('../controllers/userController');
const personnelController = require('../controllers/personnelController');
const scheduleController = require('../controllers/scheduleController');
const attendanceController = require('../controllers/attendanceController');
const excuseController = require('../controllers/excuseController');
const leaveController = require('../controllers/leaveController');
const settingsController = require('../controllers/settingsController');
const inboxController = require('../controllers/inboxController');
const liffController = require('../controllers/liffController');
const faceController = require('../controllers/faceController');
const reportController = require('../controllers/reportController');
const calendarController = require('../controllers/calendarController');
const otController = require('../controllers/otController');
const auditController = require('../controllers/auditController');

// Data endpoints
router.get('/data', checkAuth, apiController.getData);
router.get('/report/monthly', checkAuth, apiController.getMonthlyReport);

// Attendance & Notifications
router.post('/attendance', attendanceController.logAttendance);
router.post('/attendance/check-in', checkAuth, attendanceController.checkIn);
router.post('/attendance/check-out', checkAuth, attendanceController.checkOut);
router.get('/notifications/mappings', checkAuth, checkAdmin, attendanceController.getMappings);
router.post('/notifications/mappings', checkAuth, checkAdmin, attendanceController.updateMapping);
router.get('/notifications/failed', checkAuth, checkAdmin, attendanceController.getFailedNotifications);
router.get('/notifications/status', checkAuth, checkAdmin, attendanceController.getNotificationStatus);

// User management
router.get('/users', checkAuth, checkSuper, userController.getUsers);
router.post('/users', checkAuth, checkSuper, userController.saveUser);
router.post('/users/test-line', checkAuth, checkSuper, userController.testLine);
router.post('/users/test-line-flex', checkAuth, checkAdmin, userController.testLineFlex);
router.post('/users/test-telegram', checkAuth, checkSuper, userController.testTelegram);
router.delete('/users/:id', checkAuth, checkSuper, userController.deleteUser);
router.post('/users/:id/reset-password', checkAuth, checkSuper, userController.resetPassword);

// Personnel
router.get('/personnel', checkAuth, personnelController.getPersonnel);
router.get('/personnel-template2', checkAuth, personnelController.getPersonnelTemplate2);
router.get('/personnel/:fingleId', checkAuth, personnelController.getPersonByFingleId);
router.post('/staff/update', checkAuth, personnelController.updateStaff);
router.get('/attendance/history/:fingleId', checkAuth, personnelController.getAttendanceHistory);

// Schedule
router.get('/schedule', checkAuth, scheduleController.getSchedule);
router.post('/schedule', checkAuth, checkAdmin, scheduleController.postSchedule);
router.post('/schedule/save', checkAuth, checkAdmin, scheduleController.saveMonthlySchedule);
router.get('/schedule/load', checkAuth, scheduleController.loadMonthlySchedule);
router.get('/schedule/staff/:id/:yearMonth', checkAuth, scheduleController.getStaffSchedule);
router.get('/schedule/audit', checkAuth, checkAdmin, scheduleController.getScheduleAudit);

// Excuses & Reminders (3-7 Days)
router.get('/excuses', checkAuth, excuseController.getExcuses);
router.post('/excuses', checkAuth, excuseController.createExcuse);
router.put('/excuses/:id', checkAuth, excuseController.updateExcuse);
router.delete('/excuses/:id', checkAuth, excuseController.deleteExcuse);
router.post('/excuses/review', checkAuth, checkAdmin, excuseController.reviewExcuse);
router.get('/excuses/reminders', checkAuth, checkAdmin, excuseController.getRemindersList);
router.post('/excuses/send-reminders', checkAuth, checkAdmin, excuseController.sendReminders);

// Leave management
router.get('/leaves/types', checkAuth, leaveController.getTypes);
router.get('/leaves/balance', checkAuth, leaveController.getBalance);
router.get('/leaves', checkAuth, leaveController.listLeaves);
router.post('/leaves', checkAuth, leaveController.createLeave);
router.post('/leaves/:id(\\d+)/cancel', checkAuth, leaveController.cancelLeave);
router.post('/leaves/:id(\\d+)/review', checkAuth, leaveController.reviewLeave);
router.get('/leaves/:id(\\d+)/attachment', checkAuth, leaveController.getAttachment);

// Shared work settings (read: everyone, write: admin/super — enforced in controller)
router.get('/settings', checkAuth, settingsController.getSettings);
router.put('/settings', checkAuth, settingsController.saveSettings);

// Public holidays (read: everyone, write: admin/super — enforced in controller)
router.get('/holidays', checkAuth, calendarController.listHolidays);
router.post('/holidays', checkAuth, calendarController.saveHoliday);
router.post('/holidays/fixed', checkAuth, calendarController.addFixedHolidays);
router.delete('/holidays/:date', checkAuth, calendarController.deleteHoliday);
// Scanner outages (admin/super — enforced in controller)
router.get('/scan-outages', checkAuth, calendarController.listOutages);
router.post('/scan-outages', checkAuth, calendarController.saveOutage);
router.delete('/scan-outages/:id', checkAuth, calendarController.deleteOutage);

// Leave quotas per staff type (read: admin/super, write: super)
router.get('/leave-policy', checkAuth, calendarController.getPolicy);
router.put('/leave-policy', checkAuth, calendarController.savePolicy);

// Overtime requests
router.get('/ot', checkAuth, otController.listOt);
router.post('/ot', checkAuth, otController.createOt);
router.post('/ot/:id(\\d+)/cancel', checkAuth, otController.cancelOt);
router.post('/ot/:id(\\d+)/review', checkAuth, otController.reviewOt);

// System-wide audit trail (super only — enforced in controller)
router.get('/audit', checkAuth, auditController.listAudit);

// Topbar notification inbox
router.get('/notifications/inbox', checkAuth, inboxController.getInbox);

// Mobile face scan (Phase 1: LIFF sign-in, consent + enrolment, admin approval, settings)
router.post('/liff/login', liffController.login);
router.get('/face/me', checkAuth, faceController.me);
router.post('/face/enroll', checkAuth, faceController.enroll);
router.post('/face/revoke', checkAuth, faceController.revokeOwn);
router.get('/face/enrollments', checkAuth, checkAdmin, faceController.list);
router.get('/face/enrollments/:id/photo', checkAuth, faceController.photo);
router.post('/face/enrollments/:id/review', checkAuth, checkAdmin, faceController.review);
router.post('/face/enrollments/:id/revoke', checkAuth, checkAdmin, faceController.revoke);
router.get('/mobile-scan/settings', checkAuth, checkAdmin, faceController.getSettings);
router.put('/mobile-scan/settings', checkAuth, checkSuper, faceController.saveSettings);
// Monthly HR pack (.xlsx: summary, day grid, OT, leave)
router.get('/report/monthly/hr-export', checkAuth, checkAdmin, reportController.hrExport);
// Phase 2: scanning
router.post('/face/scan/challenge', checkAuth, faceController.scanChallenge);
router.post('/face/scan', checkAuth, faceController.scan);
router.get('/mobile-scans', checkAuth, checkAdmin, faceController.listScans);
router.get('/mobile-scans/:id/photo', checkAuth, faceController.scanPhoto);
router.post('/mobile-scans/:id/review', checkAuth, checkAdmin, faceController.reviewScan);

module.exports = router;
