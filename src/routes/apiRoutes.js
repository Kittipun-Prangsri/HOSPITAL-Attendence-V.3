const express = require('express');
const router = express.Router();
const { checkAuth, checkAdmin } = require('../middleware/auth');
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
router.post('/attendance/check-in', checkAuth, attendanceController.checkIn);
router.post('/attendance/check-out', checkAuth, attendanceController.checkOut);
router.get('/notifications/mappings', checkAuth, checkAdmin, attendanceController.getMappings);
router.post('/notifications/mappings', checkAuth, checkAdmin, attendanceController.updateMapping);

// User management
router.get('/users', checkAuth, checkAdmin, userController.getUsers);
router.post('/users', checkAuth, checkAdmin, userController.saveUser);
router.post('/users/test-line', checkAuth, checkAdmin, userController.testLine);
router.delete('/users/:id', checkAuth, checkAdmin, userController.deleteUser);

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
router.post('/excuses/review', checkAuth, checkAdmin, excuseController.reviewExcuse);
router.get('/excuses/reminders', checkAuth, checkAdmin, excuseController.getRemindersList);
router.post('/excuses/send-reminders', checkAuth, checkAdmin, excuseController.sendReminders);

module.exports = router;
