const express = require('express');
const router = express.Router();
const { checkAuth, checkAdmin, checkSuper } = require('../middleware/auth');
const apiController = require('../controllers/apiController');
const userController = require('../controllers/userController');
const personnelController = require('../controllers/personnelController');
const scheduleController = require('../controllers/scheduleController');
const attendanceController = require('../controllers/attendanceController');
const excuseController = require('../controllers/excuseController');

// Data endpoints
router.get('/data', checkAuth, apiController.getData);
router.get('/report/monthly', checkAuth, apiController.getMonthlyReport);

// Attendance & Notifications
router.post('/attendance', attendanceController.logAttendance);
router.post('/attendance/check-in', checkAuth, attendanceController.checkIn);
router.post('/attendance/check-out', checkAuth, attendanceController.checkOut);
router.get('/notifications/mappings', checkAuth, checkAdmin, attendanceController.getMappings);
router.post('/notifications/mappings', checkAuth, checkAdmin, attendanceController.updateMapping);

// User management
router.get('/users', checkAuth, checkSuper, userController.getUsers);
router.post('/users', checkAuth, checkSuper, userController.saveUser);
router.post('/users/test-line', checkAuth, checkSuper, userController.testLine);
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
router.post('/schedule/save', checkAuth, scheduleController.saveMonthlySchedule);
router.get('/schedule/load', checkAuth, scheduleController.loadMonthlySchedule);
router.get('/schedule/staff/:id/:yearMonth', checkAuth, scheduleController.getStaffSchedule);

// Excuses & Reminders (3-7 Days)
router.get('/excuses', checkAuth, excuseController.getExcuses);
router.post('/excuses', checkAuth, excuseController.createExcuse);
router.delete('/excuses/:id', checkAuth, excuseController.deleteExcuse);
router.post('/excuses/review', checkAuth, checkAdmin, excuseController.reviewExcuse);
router.get('/excuses/reminders', checkAuth, checkAdmin, excuseController.getRemindersList);
router.post('/excuses/send-reminders', checkAuth, checkAdmin, excuseController.sendReminders);

module.exports = router;
