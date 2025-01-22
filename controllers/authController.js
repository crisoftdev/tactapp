const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/user');

// Registrar un nuevo usuario
const register = async (req, res) => {
    try {
        const { nombre, apellido, empresa, sector, correo, celular, contrasenia } = req.body;
        
        // Encriptar la contraseña
        const hashedPassword = await bcrypt.hash(contrasenia, 10);
        
        const userId = await User.createUser(nombre, apellido, empresa, sector, correo, celular, hashedPassword);
        
        res.status(201).json({ message: 'Usuario registrado exitosamente', userId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error en el registro del usuario' });
    }
};

// Iniciar sesión (login)
const login = async (req, res) => {
    console.log("entra")
    try {
        const { correo, contrasenia } = req.body;
        
        const user = await User.getUserById(correo);  // Cambia la consulta según sea necesario
        
        if (!user) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }
        
        const isMatch = await bcrypt.compare(contrasenia, user.contrasenia);
        
        if (!isMatch) {
            return res.status(401).json({ message: 'Contraseña incorrecta' });
        }
        
        // Crear JWT
        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        
        res.status(200).json({ message: 'Inicio de sesión exitoso', token });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error en el inicio de sesión' });
    }
};

// Obtener cuenta del usuario (con autorización)
const getAccount = async (req, res) => {
    try {
        const user = await User.getUserById(req.user.userId);
        
        if (!user) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }
        
        res.status(200).json(user);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error al obtener la cuenta del usuario' });
    }
};

// Actualizar cuenta de usuario
const updateUser = async (req, res) => {
    try {
        const { nombre, apellido, empresa, sector, correo, celular, contrasenia } = req.body;
        const { userId } = req.user;
        
        // Encriptar la nueva contraseña si es que se ha cambiado
        const hashedPassword = contrasenia ? await bcrypt.hash(contrasenia, 10) : null;
        
        await User.updateUser(userId, nombre, apellido, empresa, sector, correo, celular, hashedPassword || undefined);
        
        res.status(200).json({ message: 'Usuario actualizado exitosamente' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error al actualizar el usuario' });
    }
};

// Solicitar recuperación de contraseña (enviar correo, etc.)
const requestPasswordReset = async (req, res) => {
    // Implementa la lógica aquí (enviar un correo con un enlace para resetear la contraseña)
};

// Restablecer la contraseña
const updatePassword = async (req, res) => {
    // Implementa la lógica de restablecimiento de contraseña
};

module.exports = { register, login, updateUser, getAccount, requestPasswordReset, updatePassword };


