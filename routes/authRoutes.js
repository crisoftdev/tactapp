const express = require('express');
const { register, login, updateUser, getAccount, requestPasswordReset, updatePassword } = require('../controllers/authController');
const auth = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.put('/update', auth, updateUser);
router.get('/getAccount', auth, getAccount);
router.post('/request-password-reset', requestPasswordReset); // Solicitar recuperación
 router.post('/reset-password', updatePassword); // Restablecer contraseña


module.exports = router;
