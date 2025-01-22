const mysql = require('mysql2');

// Configura la conexión con la base de datos MySQL
const pool = mysql.createPool({
    host: '152.170.159.119',
    user: 'root',  // Cambia a tu usuario
    password: 'Distri*2019*Tec',  // Cambia a tu contraseña
    database: 'distritec',  // Cambia a tu base de datos
    port: 2064,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool.promise();  // Usamos promesas para facilitar la gestión
