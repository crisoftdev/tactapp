// Ya no es necesario Sequelize, solo el archivo de configuración de conexión
const pool = require('../config/db');

// Consulta para obtener todos los usuarios
const getAllUsers = async () => {
    const [rows] = await pool.query('SELECT * FROM UserApp');
    return rows;
};

// Consulta para obtener un usuario por ID
const getUserById = async (id) => {
    const [rows] = await pool.query('SELECT * FROM UserApp WHERE id = ?', [id]);
    return rows[0];  // Devuelve el primer usuario encontrado
};

// Crear un nuevo usuario
const createUser = async (nombre, apellido, empresa, sector, correo, celular, contrasenia) => {
    const [result] = await pool.query('INSERT INTO UserApp (nombre, apellido, empresa, sector, correo, celular, contrasenia) VALUES (?, ?, ?, ?, ?, ?, ?)', 
    [nombre, apellido, empresa, sector, correo, celular, contrasenia]);
    return result.insertId;  // Devuelve el ID del nuevo usuario
};

// Actualizar un usuario
const updateUser = async (id, nombre, apellido, empresa, sector, correo, celular, contrasenia) => {
    await pool.query('UPDATE UserApp SET nombre = ?, apellido = ?, empresa = ?, sector = ?, correo = ?, celular = ?, contrasenia = ? WHERE id = ?', 
    [nombre, apellido, empresa, sector, correo, celular, contrasenia, id]);
};

// Eliminar un usuario
const deleteUser = async (id) => {
    await pool.query('DELETE FROM UserApp WHERE id = ?', [id]);
};

module.exports = { getAllUsers, getUserById, createUser, updateUser, deleteUser };
