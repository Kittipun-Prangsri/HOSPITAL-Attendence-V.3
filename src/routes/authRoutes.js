const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { loginRateLimit } = require('../middleware/loginRateLimit');

router.get('/login', authController.getLogin);
router.post('/login', loginRateLimit, authController.postLogin);
router.get('/logout', authController.logout);

module.exports = router;
