require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const mysql = require('mysql2');
const axios = require('axios');
const cron = require('node-cron');

// Configuración de la base de datos MySQL
const pool = mysql.createPool({
    host: '152.170.159.119',
    user: 'root',  // Cambia a tu usuario
    password: 'Distri*2019*Tec',  // Cambia a tu contraseña
    database: 'distritec',  // Cambia a tu base de datos
    port: 2064,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

// Inicializar Express
const app = express();

// Middleware para JSON
app.use(express.json());

// Configuración de CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Modelo de Usuario (consultas directas a la base de datos)
const User = {
    findOne: (conditions) => {
        return new Promise((resolve, reject) => {
            pool.query('SELECT * FROM usersApp WHERE correo = ?', [conditions.where.correo], (err, results) => {
                if (err) reject(err);
                resolve(results[0]); // Retorna el primer resultado
            });
        });
    },
    createUser: (data) => {
        return new Promise((resolve, reject) => {
            pool.query('INSERT INTO usersApp (correo, contrasenia) VALUES (?, ?)',
                [data.correo, data.contrasenia], (err, results) => {
                    if (err) reject(err);
                    resolve(results.insertId); // Retorna el ID del usuario creado
                });
        });
    }
};
// Ruta de registro de usuario
app.post('/api/auth/register', async (req, res) => {
    const { correo, contrasenia } = req.body;
    try {
        // Verificar si el correo ya está registrado
        const existingUser = await User.findOne({ where: { correo } });
        if (existingUser) {
            return res.status(400).json({ message: 'El correo ya está registrado' });
        }

        // Encriptar la contraseña
        const hashedPassword = await bcrypt.hash(contrasenia, 10);

        // Crear el nuevo usuario
        const userId = await User.createUser({ correo, contrasenia: hashedPassword });
        res.status(201).json({ message: 'Usuario registrado exitosamente', userId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error en el registro del usuario', error: error.message });
    }
});
// Ruta de inicio de sesión (login)
app.post('/api/auth/login', async (req, res) => {
    const { correo, contrasenia } = req.body;
    try {
        const user = await User.findOne({ where: { correo } });

        if (!user) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }

        const isMatch = await bcrypt.compare(contrasenia, user.contrasenia);
        if (!isMatch) {
            return res.status(401).json({ message: 'Contraseña incorrecta' });
        }

        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '60d' });
        res.status(200).json({ message: 'Inicio de sesión exitoso', token });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error en el inicio de sesión' });
    }
});
// Ruta para obtener los pedidos (ejemplo, puedes personalizarlo)
app.get('/api/orders', (req, res) => {
    pool.query('SELECT * FROM orders', (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Error al obtener pedidos' });
        }
        res.status(200).json(results);
    });
});
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Acceso denegado. Token requerido.' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Token inválido o expirado.' });
        }
        req.user = user;
        next();
    });
}
app.get('/api/requerimientoshoy', authenticateToken, (req, res) => {
    const query = `SELECT sum(requerimientos.SubTotal2) AS suma, COUNT(*) AS cantidad
FROM requerimientos
WHERE date(requerimientos.FechaCreacion)= CURDATE() AND requerimientos.Estado=0 

    `;

    pool.query(query, (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results[0]);
    });
});
app.get('/api/presupuestoshoy', authenticateToken, (req, res) => {
    const idusuario = req.user.userId;
    const query = `
         SELECT *,
   (SELECT presupuestos 
             FROM objetivosdiarios 
             WHERE idusuario = ?) AS objetivo_diario 
 from resumen_presupuestos
        WHERE DATE(resumen_presupuestos.creado_en) = CURDATE();
    `;

    pool.query(query, [idusuario], (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results[0]);
    });
});
app.get('/api/pedidoshoy', authenticateToken, (req, res) => {
    const idusuario = req.user.userId;

    const query = `SELECT * ,
  (SELECT pedidos 
             FROM objetivosdiarios 
             WHERE idusuario = ?) AS objetivo_diario
FROM resumen_pedidos
WHERE DATE(resumen_pedidos.creado_en) = CURDATE()

    `;

    pool.query(query, [idusuario], (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results[0]);
    });
});
app.get('/api/pedidosDetallehoy', authenticateToken, (req, res) => {
    const query = `
        SELECT fiscal.RazonSocial, pedidos.Total, usuarios.Usuario, pedidos.NroMoneda,  pedidos.estado, pedidos.escenario,
        CAST(TIME(pedidos.fechacreacion) AS CHAR) AS Hora, pedidos.numero,pedidos.id,
        CONCAT(cast(LPAD(talonarios.NroSucursal,4,0) AS CHAR),'-',cast(LPAD(pedidos.Numero,8,0) AS CHAR)) AS Numero,
 ROUND(
        CASE 
            WHEN pedidos.NroMoneda = 1 THEN pedidos.subtotal
            WHEN pedidos.NroMoneda = 2 THEN pedidos.subtotal * (
                SELECT cotmoneda2 
                FROM monedacotizaciones 
                ORDER BY fechahora DESC 
                LIMIT 1
            )
            WHEN pedidos.NroMoneda = 3 THEN pedidos.subtotal * (
                SELECT cotmoneda3 
                FROM monedacotizaciones 
                ORDER BY fechahora DESC 
                LIMIT 1
            )
            ELSE 0 -- En caso de que NroMoneda no coincida con 1, 2 o 3
        END, 
    2) AS Total_Ped,
        (SELECT 
        ROUND(
            SUM(
                CASE 
                    WHEN p.NroMoneda = 1 THEN p.subtotal
                    WHEN p.NroMoneda = 2 THEN p.subtotal * (
                        SELECT cotmoneda2 
                        FROM monedacotizaciones 
                        ORDER BY fechahora DESC 
                        LIMIT 1
                    )
                    WHEN p.NroMoneda = 3 THEN p.subtotal * (
                        SELECT cotmoneda3 
                        FROM monedacotizaciones 
                        ORDER BY fechahora DESC 
                        LIMIT 1
                    )
                    ELSE 0
                END
            ), 2
        )
     FROM pedidos p
     WHERE DATE(p.FechaCreacion) = CURDATE()
    ) AS suma
    
    
FROM pedidos
JOIN fiscal ON fiscal.RecID=pedidos.IDFiscal
JOIN usuarios ON usuarios.recid = pedidos.IDUsuarioCreacion
JOIN talonarios ON talonarios.RecID = pedidos.IDTalonario
WHERE date(pedidos.FechaCreacion) = CURDATE() AND pedidos.Estado<>2
ORDER BY pedidos.Total DESC;

    `;

    pool.query(query, (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results);
    });
});
app.get('/api/pedidosDetalleMes', authenticateToken, (req, res) => {
    const mes = parseInt(req.query.mes);
    console.log("messs", mes)
    const query = `
         SELECT fiscal.RazonSocial, pedidos.Total, usuarios.Usuario, pedidos.NroMoneda,  pedidos.estado, pedidos.escenario,
        CAST(TIME(pedidos.fechacreacion) AS CHAR) AS Hora, pedidos.numero,pedidos.id,
        CONCAT(cast(LPAD(talonarios.NroSucursal,4,0) AS CHAR),'-',cast(LPAD(pedidos.Numero,8,0) AS CHAR)) AS Numero,
 ROUND(
        CASE 
            WHEN pedidos.NroMoneda = 1 THEN pedidos.Total
            WHEN pedidos.NroMoneda = 2 THEN pedidos.Total * (
                SELECT cotmoneda2 
                FROM monedacotizaciones 
                ORDER BY fechahora DESC 
                LIMIT 1
            )
            WHEN pedidos.NroMoneda = 3 THEN pedidos.Total * (
                SELECT cotmoneda3 
                FROM monedacotizaciones 
                ORDER BY fechahora DESC 
                LIMIT 1
            )
            ELSE 0 -- En caso de que NroMoneda no coincida con 1, 2 o 3
        END, 
    2) AS Total_Ped,
        (SELECT 
        ROUND(
            SUM(
                CASE 
                    WHEN p.NroMoneda = 1 THEN p.Total
                    WHEN p.NroMoneda = 2 THEN p.Total * (
                        SELECT cotmoneda2 
                        FROM monedacotizaciones 
                        ORDER BY fechahora DESC 
                        LIMIT 1
                    )
                    WHEN p.NroMoneda = 3 THEN p.Total * (
                        SELECT cotmoneda3 
                        FROM monedacotizaciones 
                        ORDER BY fechahora DESC 
                        LIMIT 1
                    )
                    ELSE 0
                END
            ), 2
        )
     FROM pedidos p
     WHERE MONTH(p.FechaCreacion) = ? AND YEAR(p.fechacreacion) = YEAR(CURDATE())
    ) AS suma
    
    
FROM pedidos
JOIN fiscal ON fiscal.RecID=pedidos.IDFiscal
JOIN usuarios ON usuarios.recid = pedidos.IDUsuarioCreacion
JOIN talonarios ON talonarios.RecID = pedidos.IDTalonario
WHERE MONTH(pedidos.FechaCreacion) = ? AND YEAR(pedidos.fechacreacion) = YEAR(CURDATE()) AND pedidos.Estado<>2
ORDER BY pedidos.Total DESC;

    `;

    pool.query(query, [mes, mes], (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results);
    });
});
app.get('/api/requerimientosDetallehoy', authenticateToken, (req, res) => {
    const query = `
        SELECT 
    fiscal.RazonSocial, 
    requerimientos.Total,
    requerimientos.SubTotal, 
    requerimientos.SubTotal2, 
    requerimientos.NroMoneda, 
    requerimientos.fechacreacion, 
    requerimientos.numero, 
    requerimientos.id,
    requerimientos.estado,
    (SELECT SUM(SubTotal2) 
     FROM requerimientos 
     WHERE DATE(requerimientos.FechaCreacion) = CURDATE()) AS total_subtotal2,
    (SELECT COUNT(*) 
     FROM requerimientos 
     WHERE DATE(requerimientos.FechaCreacion) = CURDATE()) AS cantidad_requerimientos
FROM requerimientos 
JOIN fiscal ON fiscal.RecID = requerimientos.IDFiscal
WHERE DATE(requerimientos.FechaCreacion) = CURDATE()    `;

    pool.query(query, (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results);
    });
});
app.get('/api/requerimientosDetallemes', authenticateToken, (req, res) => {
    const mes = parseInt(req.query.mes);
    const query = `
         SELECT 
    fiscal.RazonSocial, 
    requerimientos.Total,
    requerimientos.SubTotal, 
    requerimientos.SubTotal2, 
    requerimientos.NroMoneda, 
    requerimientos.fechacreacion, 
    requerimientos.numero, 
    requerimientos.id,
    requerimientos.estado,
    (SELECT SUM(SubTotal2) 
     FROM requerimientos 
     WHERE MONTH(requerimientos.FechaCreacion) = ?
AND DATE(requerimientos.fechacreacion) = YEAR(CURDATE())) AS total_subtotal2,
    (SELECT COUNT(*) 
     FROM requerimientos 
     WHERE MONTH(requerimientos.FechaCreacion) = ?
AND DATE(requerimientos.fechacreacion) = YEAR(CURDATE())) AS cantidad_requerimientos
FROM requerimientos 
JOIN fiscal ON fiscal.RecID = requerimientos.IDFiscal
WHERE MONTH(requerimientos.FechaCreacion) = ?
AND DATE(requerimientos.fechacreacion) = YEAR(CURDATE())`;

    pool.query(query, [mes, mes, mes], (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results);
    });
});
app.get('/api/pedidosDetalleItems/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    const query = `
SELECT fiscal.RazonSocial,  
        CONCAT(cast(LPAD(talonarios.NroSucursal,4,0) AS CHAR),'-',cast(LPAD(pedidos.Numero,8,0) AS CHAR)) AS Numero, 
        pedidos.Subtotal, pedidos.Impuesto, pedidos.percepciones as percepcion, pedidos.Total, 
        pedidos.FechaCreacion,  pedidositems.Codigo, pedidositems.Descripcion, 
        pedidositems.cantidad, pedidositems.ImporteUnitario1, pedidositems.ImportePrecio1, 
if(pedidositems.Escenario='','0',pedidositems.Escenario) AS Escenario, pedidositems.estado as estadoitem
FROM pedidos
JOIN pedidositems ON pedidositems.idpedido=pedidos.RecID
JOIN fiscal ON fiscal.RecID=pedidos.IDFiscal
JOIN talonarios ON talonarios.RecID = pedidos.IDTalonario
WHERE pedidos.id = ?;
    `;

    pool.query(query, [id], (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results);
    });
});
app.get('/api/requerimientosDetalleItems/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    const query = `
SELECT fiscal.RazonSocial, requerimientos.ID AS Numero, requerimientos.SubTotal, requerimientos.SubTotal2, requerimientos.Impuesto, requerimientos.Total,
requerimientos.FechaCreacion, requerimientositems.Codigo, requerimientositems.Descripcion, requerimientositems.cantidad, requerimientositems.ImporteUnitario1, requerimientositems.ImportePrecio1, requerimientositems.Estado AS estadoitem, requerimientos.Descuento
FROM requerimientos
JOIN requerimientositems ON requerimientositems.IDRequerimiento=requerimientos.RecID
JOIN fiscal ON fiscal.RecID=requerimientos.IDFiscal
WHERE requerimientos.id= ?;
    `;

    pool.query(query, [id], (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results);
    });
});
app.get('/api/facturashoy', authenticateToken, (req, res) => {
    const idusuario = req.user.userId;

    const query = `
        SELECT
            (SELECT 
                ROUND(
                    SUM(
                        CASE 
                            WHEN facturas.tipo = 1 THEN -- Nota de crédito
                                CASE
                                    WHEN facturas.NroMoneda = 1 THEN 
                                        IF(facturas.TipoMultitipo=2,-(facturas.subtotal - Impuesto), -facturas.Subtotal)
                                    WHEN facturas.NroMoneda = 2 THEN 
                                        IF(facturas.TipoMultitipo=2,-(facturas.subtotal - Impuesto), -facturas.Subtotal) * (
                                            SELECT cotmoneda2 
                                            FROM monedacotizaciones 
                                            ORDER BY fechahora DESC 
                                            LIMIT 1
                                        )
                                    WHEN facturas.NroMoneda = 3 THEN 
                                        -facturas.Subtotal * (
                                            SELECT cotmoneda3 
                                            FROM monedacotizaciones 
                                            ORDER BY fechahora DESC 
                                            LIMIT 1
                                        )
                                    ELSE 0
                                END
                            ELSE -- Factura normal
                                CASE
                                    WHEN facturas.NroMoneda = 1 THEN 
                                        IF(facturas.TipoMultitipo=2,(facturas.subtotal - Impuesto), facturas.Subtotal)
                                    WHEN facturas.NroMoneda = 2 THEN 
                                        IF(facturas.TipoMultitipo=2,-(facturas.subtotal - Impuesto), facturas.Subtotal) * (
                                            SELECT cotmoneda2 
                                            FROM monedacotizaciones 
                                            ORDER BY fechahora DESC 
                                            LIMIT 1
                                        )
                                    WHEN facturas.NroMoneda = 3 THEN 
                                        facturas.Subtotal * (
                                            SELECT cotmoneda3 
                                            FROM monedacotizaciones 
                                            ORDER BY fechahora DESC 
                                            LIMIT 1
                                        )
                                    ELSE 0
                                END
                        END
                    ), 
                2)
            FROM facturas
            WHERE DATE(facturas.FechaCreacion) = CURDATE() 
              AND facturas.Estado IN (0, 1, 5)
            ) AS suma,

            (SELECT COUNT(*) 
             FROM facturas
             WHERE DATE(facturas.FechaCreacion) = CURDATE() 
               AND facturas.Estado IN (0, 1, 5)
            ) AS cantidad,

            (SELECT facturas 
             FROM objetivosmensuales 
             WHERE idusuario = ?) AS objetivo_mensual,

            (SELECT facturas 
             FROM objetivosdiarios 
             WHERE idusuario = ?) AS objetivo_diario

        FROM facturas
        JOIN fiscal ON fiscal.RecID = facturas.IDFiscal
        WHERE DATE(facturas.FechaCreacion) = CURDATE() 
          AND facturas.Estado IN (0, 1, 5)
        ORDER BY facturas.Total DESC
        LIMIT 1;
    `;

    pool.query(query, [idusuario, idusuario], (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results[0]);
    });
});
app.get('/api/facturasDetallehoy', authenticateToken, (req, res) => {
    const query = `
        SELECT 
    (SELECT COUNT(*) 
     FROM facturas 
     WHERE DATE(facturas.FechaCreacion) = CURDATE() 
       AND facturas.Estado IN (0, 1, 5)) AS cantidad, 
    (SELECT SUM(
        CASE  
            WHEN f.tipo = 0 THEN f.Subtotal
            WHEN f.tipo = 1 THEN -f.Subtotal
            ELSE 0 
        END)
     FROM facturas f
     WHERE DATE(f.FechaCreacion) = CURDATE() 
       AND f.Estado IN (0, 1, 5)) AS suma_total, -- Subconsulta para sumar los subtotales
        
    fiscal.RazonSocial, 
    usuarios.Usuario, 
    CAST(TIME(facturas.fechacreacion) AS CHAR) AS Hora, 
    facturas.nromoneda, 
    facturas.id, 
    CONCAT(CAST(LPAD(talonarios.NroSucursal,4,0) AS CHAR), '-', CAST(LPAD(facturas.Numero,8,0) AS CHAR)) AS Numero,
    CASE  
        WHEN facturas.tipo = 0 THEN facturas.Total
        WHEN facturas.tipo = 1 THEN -facturas.Total
        ELSE 0 
    END AS fact
FROM facturas
JOIN fiscal ON fiscal.RecID = facturas.IDFiscal
JOIN usuarios ON usuarios.recid = facturas.IDUsuario
JOIN talonarios ON talonarios.RecID = facturas.IDTalonario
WHERE DATE(facturas.FechaCreacion) = CURDATE() 
  AND facturas.Estado IN (0, 1, 5)
GROUP BY 
    fiscal.RazonSocial, 
    usuarios.Usuario, 
    Hora, 
    facturas.nromoneda, 
    facturas.id, 
    Numero, 
    fact
ORDER BY facturas.Total DESC;

    `;

    pool.query(query, (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results);
    });
});
app.get('/api/facturasdetallemes', authenticateToken, (req, res) => {
    const mes = parseInt(req.query.mes);
    console.log(mes)
    const query = `
       SELECT         
    fiscal.RazonSocial, 
    usuarios.Usuario, 
    CAST(TIME(facturas.fechacreacion) AS CHAR) AS Hora, 
    facturas.nromoneda, 
    facturas.id, 
    CONCAT(CAST(LPAD(talonarios.NroSucursal,4,0) AS CHAR), '-', CAST(LPAD(facturas.Numero,8,0) AS CHAR)) AS Numero,
    CASE  
        WHEN facturas.tipo = 0 THEN facturas.Total
        WHEN facturas.tipo = 1 THEN -facturas.Total
        ELSE 0 
    END AS fact
FROM facturas
JOIN fiscal ON fiscal.RecID = facturas.IDFiscal
JOIN usuarios ON usuarios.recid = facturas.IDUsuario
JOIN talonarios ON talonarios.RecID = facturas.IDTalonario
WHERE MONTH(facturas.FechaCreacion) = ? AND DATE(facturas.FechaCreacion) = YEAR(CURDATE())
  AND facturas.Estado IN (0, 1, 5)
GROUP BY 
    fiscal.RazonSocial, 
    usuarios.Usuario, 
    Hora, 
    facturas.nromoneda, 
    facturas.id, 
    Numero, 
    fact
ORDER BY facturas.Total DESC;

    `;

    pool.query(query, [mes], (err, results) => {
        console.log(results)

        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results);
    });
});
app.get('/api/facturasDetalleItems/:id', authenticateToken, (req, res) => {
    const { id } = req.params; // Extrae el ID de los parámetros de la URL
    const query = `
        SELECT fiscal.RazonSocial,  
        CONCAT(cast(LPAD(talonarios.NroSucursal,4,0) AS CHAR),'-',cast(LPAD(facturas.Numero,8,0) AS CHAR)) AS Numero, 
        facturas.Subtotal, facturas.Impuesto, facturas.Percepcion, facturas.Total, facturas.CAE,
        facturas.FechaCreacion, facturasitems.NroItem, facturasitems.Codigo, facturasitems.Descripcion, 
        facturasitems.cantidad, facturasitems.ImporteUnitario1, facturasitems.ImportePrecio1
        FROM facturas
        JOIN facturasitems ON facturasitems.IDFactura = facturas.RecID
        JOIN fiscal ON fiscal.RecID = facturas.IDFiscal
        JOIN talonarios ON talonarios.RecID = facturas.IDTalonario
        WHERE facturas.id = ?;
    `;

    pool.query(query, [id], (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results);
    });
});
app.get('/api/presupuestosDetallehoy', authenticateToken, (req, res) => {
    const query = `
        SELECT 
    empresas.Empresa, 
    presupuestos.Total, 
    CAST(TIME(presupuestos.fechacreacion) AS CHAR) AS Hora, 
    presupuestos.estado, presupuestos.id,
    ROUND(
        CASE 
            WHEN presupuestos.NroMoneda = 1 THEN presupuestos.subtotal
            WHEN presupuestos.NroMoneda = 2 THEN presupuestos.subtotal * (
                SELECT cotmoneda2 
                FROM monedacotizaciones 
                ORDER BY fechahora DESC 
                LIMIT 1
            )
            WHEN presupuestos.NroMoneda = 3 THEN presupuestos.subtotal * (
                SELECT cotmoneda3 
                FROM monedacotizaciones 
                ORDER BY fechahora DESC 
                LIMIT 1
            )
            ELSE 0 -- En caso de que NroMoneda no coincida con 1, 2 o 3
        END, 
    2) AS Total_Cot,
    usuarios.Usuario, 
    presupuestos.NroMoneda,
    -- Suma total de todos los presupuestos del día
    (SELECT 
        ROUND(
            SUM(
                CASE 
                    WHEN p.NroMoneda = 1 THEN p.subtotal
                    WHEN p.NroMoneda = 2 THEN p.subtotal * (
                        SELECT cotmoneda2 
                        FROM monedacotizaciones 
                        ORDER BY fechahora DESC 
                        LIMIT 1
                    )
                    WHEN p.NroMoneda = 3 THEN p.subtotal * (
                        SELECT cotmoneda3 
                        FROM monedacotizaciones 
                        ORDER BY fechahora DESC 
                        LIMIT 1
                    )
                    ELSE 0
                END
            ), 2
        )
     FROM presupuestos p
     WHERE DATE(p.FechaCreacion) = CURDATE()
    ) AS suma,
    -- Suma de totales cuando estado=0
    (SELECT 
        ROUND(
            SUM(
                CASE 
                    WHEN p.NroMoneda = 1 THEN p.subtotal
                    WHEN p.NroMoneda = 2 THEN p.subtotal * (
                        SELECT cotmoneda2 
                        FROM monedacotizaciones 
                        ORDER BY fechahora DESC 
                        LIMIT 1
                    )
                    WHEN p.NroMoneda = 3 THEN p.subtotal * (
                        SELECT cotmoneda3 
                        FROM monedacotizaciones 
                        ORDER BY fechahora DESC 
                        LIMIT 1
                    )
                    ELSE 0
                END
            ), 2
        )
     FROM presupuestos p
     WHERE DATE(p.FechaCreacion) = CURDATE() AND p.estado = 0
    ) AS suma_estado_0,
    -- Suma de totales cuando estado=1
    ifnull((SELECT 
        ROUND(
            SUM(
                CASE 
                    WHEN p.NroMoneda = 1 THEN p.subtotal
                    WHEN p.NroMoneda = 2 THEN p.subtotal * (
                        SELECT cotmoneda2 
                        FROM monedacotizaciones 
                        ORDER BY fechahora DESC 
                        LIMIT 1
                    )
                    WHEN p.NroMoneda = 3 THEN p.subtotal * (
                        SELECT cotmoneda3 
                        FROM monedacotizaciones 
                        ORDER BY fechahora DESC 
                        LIMIT 1
                    )
                    ELSE 0
                END
            ), 2
        )
     FROM presupuestos p
     WHERE DATE(p.FechaCreacion) = CURDATE() AND p.estado = 1
    ),0) AS suma_estado_1
FROM presupuestos
JOIN contactos ON contactos.IDContacto = presupuestos.IDRef
JOIN empresas ON empresas.idempresa = contactos.IDEmpresa
JOIN usuarios ON usuarios.recid = presupuestos.IDUsuarioCreacion
WHERE DATE(presupuestos.FechaCreacion) = CURDATE()
                        ORDER BY presupuestos.Total DESC;

    `;

    pool.query(query, (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results);
    });
});
app.get('/api/presupuestosDetallemes', authenticateToken, (req, res) => {
    const mes = parseInt(req.query.mes);
    const query = `
        SELECT 
    empresas.Empresa, 
    presupuestos.Total, 
    CAST(TIME(presupuestos.fechacreacion) AS CHAR) AS Hora, 
    presupuestos.estado, presupuestos.id,
    ROUND(
        CASE 
            WHEN presupuestos.NroMoneda = 1 THEN presupuestos.Total
            WHEN presupuestos.NroMoneda = 2 THEN presupuestos.Total * (
                SELECT cotmoneda2 
                FROM monedacotizaciones 
                ORDER BY fechahora DESC 
                LIMIT 1
            )
            WHEN presupuestos.NroMoneda = 3 THEN presupuestos.Total * (
                SELECT cotmoneda3 
                FROM monedacotizaciones 
                ORDER BY fechahora DESC 
                LIMIT 1
            )
            ELSE 0 -- En caso de que NroMoneda no coincida con 1, 2 o 3
        END, 
    2) AS Total_Cot,
    usuarios.Usuario, 
    presupuestos.NroMoneda,
    -- Suma total de todos los presupuestos del día
    (SELECT 
        ROUND(
            SUM(
                CASE 
                    WHEN p.NroMoneda = 1 THEN p.Total
                    WHEN p.NroMoneda = 2 THEN p.Total * (
                        SELECT cotmoneda2 
                        FROM monedacotizaciones 
                        ORDER BY fechahora DESC 
                        LIMIT 1
                    )
                    WHEN p.NroMoneda = 3 THEN p.Total * (
                        SELECT cotmoneda3 
                        FROM monedacotizaciones 
                        ORDER BY fechahora DESC 
                        LIMIT 1
                    )
                    ELSE 0
                END
            ), 2
        )
     FROM presupuestos p
         WHERE MONTH(p.FechaCreacion) = ? AND DATE(p.fechacreacion) = YEAR(CURDATE())
    ) AS suma,
    -- Suma de totales cuando estado=0
    (SELECT 
        ROUND(
            SUM(
                CASE 
                    WHEN p.NroMoneda = 1 THEN p.Total
                    WHEN p.NroMoneda = 2 THEN p.Total * (
                        SELECT cotmoneda2 
                        FROM monedacotizaciones 
                        ORDER BY fechahora DESC 
                        LIMIT 1
                    )
                    WHEN p.NroMoneda = 3 THEN p.Total * (
                        SELECT cotmoneda3 
                        FROM monedacotizaciones 
                        ORDER BY fechahora DESC 
                        LIMIT 1
                    )
                    ELSE 0
                END
            ), 2
        )
     FROM presupuestos p
         WHERE MONTH(p.FechaCreacion) = ? AND DATE(p.fechacreacion) = YEAR(CURDATE()) AND p.estado = 0
    ) AS suma_estado_0,
    -- Suma de totales cuando estado=1
    ifnull((SELECT 
        ROUND(
            SUM(
                CASE 
                    WHEN p.NroMoneda = 1 THEN p.Total
                    WHEN p.NroMoneda = 2 THEN p.Total * (
                        SELECT cotmoneda2 
                        FROM monedacotizaciones 
                        ORDER BY fechahora DESC 
                        LIMIT 1
                    )
                    WHEN p.NroMoneda = 3 THEN p.Total * (
                        SELECT cotmoneda3 
                        FROM monedacotizaciones 
                        ORDER BY fechahora DESC 
                        LIMIT 1
                    )
                    ELSE 0
                END
            ), 2
        )
     FROM presupuestos p
          WHERE MONTH(p.FechaCreacion) = ? AND DATE(p.fechacreacion) = YEAR(CURDATE()) AND p.estado = 1
    ),0) AS suma_estado_1
FROM presupuestos
JOIN contactos ON contactos.IDContacto = presupuestos.IDRef
JOIN empresas ON empresas.idempresa = contactos.IDEmpresa
JOIN usuarios ON usuarios.recid = presupuestos.IDUsuarioCreacion
   WHERE MONTH(presupuestos.FechaCreacion) = ? AND DATE(presupuestos.fechacreacion) = YEAR(CURDATE())
                        ORDER BY presupuestos.Total DESC;

    `;

    pool.query(query, [mes, mes, mes, mes], (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results);
    });
});
app.get('/api/presupuestosDetalleItems/:id', authenticateToken, (req, res) => {
    const { id } = req.params; // Extrae el ID de los parámetros de la URL
    const query = `
SELECT empresas.empresa AS RazonSocial, presupuestos.ID AS Numero, presupuestos.Subtotal, presupuestos.Impuesto, presupuestos.Total,presupuestos.FechaCreacion, 
presupuestositems.Codigo, presupuestositems.Descripcion, presupuestositems.Cantidad, presupuestositems.ImporteUnitario1, presupuestositems.ImportePrecio1
FROM presupuestos
JOIN presupuestositems ON presupuestositems.IDPresupuesto=presupuestos.RecID
JOIN contactos ON contactos.idcontacto=presupuestos.IDRef
JOIN empresas ON empresas.IDEmpresa=contactos.IDEmpresa
WHERE presupuestos.ID= ?;
    `;

    pool.query(query, [id], (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results);
    });
});
app.get('/api/busquedaRequerimientos', authenticateToken, (req, res) => {
    const { empresa, fechaDesde, fechaHasta } = req.query;
    // Construye la consulta SQL dinámicamente
    let conditions = [];
    let values = [];

    if (empresa) {
        conditions.push("fiscal.RazonSocial LIKE ?");
        values.push(`%${empresa}%`);
    }
    if (fechaDesde) {
        conditions.push("DATE(requerimientos.FechaCreacion) >= ?");
        values.push(fechaDesde);
    }
    if (fechaHasta) {
        conditions.push("DATE(requerimientos.FechaCreacion) <= ?");
        values.push(fechaHasta);
    }


    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const query =
        `SELECT 
            fiscal.RazonSocial, 
            requerimientos.Total AS Total2,
            if (requerimientos.NroMoneda=1,requerimientos.total,requerimientos.Total* monedacotizaciones.CotMoneda2) AS Total,
             if (requerimientos.NroMoneda=1,requerimientos.SubTotal,requerimientos.SubTotal* monedacotizaciones.CotMoneda2) AS SubTotal,
              if (requerimientos.NroMoneda=1,requerimientos.SubTotal2,requerimientos.SubTotal2* monedacotizaciones.CotMoneda2) AS SubTotal2,
            requerimientos.SubTotal AS SubTotalBis, 
            requerimientos.SubTotal2 AS SubTotalBis2, 
            requerimientos.NroMoneda, 
            requerimientos.fechacreacion, 
            requerimientos.numero, 
            requerimientos.id,
            requerimientos.estado
FROM requerimientos 
JOIN requerimientositems ON requerimientositems.IDRequerimiento=requerimientos.RecID
JOIN fiscal ON fiscal.RecID=requerimientos.IDFiscal
LEFT JOIN monedacotizaciones ON monedacotizaciones.RecID=requerimientositems.IDCotizacionMoneda
        ${whereClause}
        GROUP BY requerimientos.RecID
        ORDER BY requerimientos.FechaCreacion DESC;`
        ;

    pool.query(query, values, (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results);
    });
});
app.get('/api/busquedaPedidos', authenticateToken, (req, res) => {
    const { empresa, fechaDesde, fechaHasta } = req.query;
    // Construye la consulta SQL dinámicamente
    let conditions = [];
    let values = [];

    if (empresa) {
        conditions.push("fiscal.RazonSocial LIKE ?");
        values.push(`%${empresa}%`);
    }
    if (fechaDesde) {
        conditions.push("DATE(pedidos.FechaCreacion) >= ?");
        values.push(fechaDesde);
    }
    if (fechaHasta) {
        conditions.push("DATE(pedidos.FechaCreacion) <= ?");
        values.push(fechaHasta);
    }


    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const query =
        `SELECT 
            fiscal.RazonSocial, 
            pedidos.Total AS Total2,
            if (pedidos.NroMoneda=1,pedidos.total,pedidos.Total* monedacotizaciones.CotMoneda2) AS Total,
            if (pedidos.NroMoneda=1,pedidos.SubTotal,pedidos.SubTotal* monedacotizaciones.CotMoneda2) AS SubTotal,
            pedidos.SubTotal as SubTotal2, 
            usuarios.Usuario, 
            pedidos.NroMoneda, 
            pedidos.fechacreacion, 
            pedidos.numero, 
            pedidos.id,
            pedidos.estado,
            pedidos.escenario,
            monedacotizaciones.CotMoneda2
        FROM pedidos
        JOIN pedidositems ON pedidositems.IDPedido=pedidos.RecID
        JOIN fiscal ON fiscal.RecID = pedidos.IDFiscal
        JOIN usuarios ON usuarios.recid = pedidos.IDUsuarioCreacion
        LEFT JOIN monedacotizaciones ON monedacotizaciones.RecID=pedidositems.IDCotizacionMoneda
        ${whereClause}
        GROUP BY pedidos.RecID ORDER BY pedidos.FechaCreacion DESC ;`
        ;

    pool.query(query, values, (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results);
    });
});
app.get('/api/busquedaPresupuestos', authenticateToken, (req, res) => {
    const { empresa, fechaDesde, fechaHasta } = req.query;
    // Construye la consulta SQL dinámicamente
    let conditions = [];
    let values = [];

    if (empresa) {
        conditions.push("fiscal.RazonSocial LIKE ?");
        values.push(`%${empresa}%`);
    }
    if (fechaDesde) {
        conditions.push("DATE(presupuestos.FechaCreacion) >= ?");
        values.push(fechaDesde);
    }
    if (fechaHasta) {
        conditions.push("DATE(presupuestos.FechaCreacion) <= ?");
        values.push(fechaHasta);
    }


    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const query =
        `SELECT 
            fiscal.RazonSocial, 
            presupuestos.Total AS Total2,
            if (presupuestos.NroMoneda=1,presupuestos.total,presupuestos.Total* monedacotizaciones.CotMoneda2) AS Total,
            if (presupuestos.NroMoneda=1,presupuestos.SubTotal2,presupuestos.SubTotal2* monedacotizaciones.CotMoneda2) AS SubTotal,
            presupuestos.SubTotal as SubTotal2, 
            usuarios.Usuario, 
            presupuestos.NroMoneda, 
            presupuestos.fechacreacion,  
            presupuestos.id,
            presupuestos.estado
        FROM presupuestos
        JOIN presupuestositems ON presupuestositems.IDPresupuesto=presupuestos.RecID
        JOIN contactos ON contactos.IDContacto=presupuestos.IDRef
        JOIN empresas ON empresas.IDEmpresa=contactos.IDEmpresa
        JOIN fiscal ON fiscal.IDRef = empresas.IDEmpresa AND fiscal.Defecto=1
        JOIN usuarios ON usuarios.recid = presupuestos.IDUsuarioCreacion
         LEFT JOIN monedacotizaciones ON monedacotizaciones.RecID=presupuestositems.IDCotizacionMoneda
        ${whereClause}
        AND presupuestos.Estado<>2 GROUP BY presupuestos.RecID ORDER BY presupuestos.FechaCreacion DESC`
        ;

    pool.query(query, values, (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results);
    });
});
app.get('/api/busquedaFacturas', authenticateToken, (req, res) => {
    const { empresa, fechaDesde, fechaHasta } = req.query;

    const conditions = [];
    const values = [];

    if (empresa) {
        conditions.push("fiscal.RazonSocial LIKE ?");
        values.push(`%${empresa}%`);
    }
    if (fechaDesde) {
        conditions.push("DATE(facturas.FechaCreacion) >= ?");
        values.push(fechaDesde);
    }
    if (fechaHasta) {
        conditions.push("DATE(facturas.FechaCreacion) <= ?");
        values.push(fechaHasta);
    }

    conditions.push("facturas.Estado IN (0, 1, 5)");

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const query = `
    SELECT 
        A.*, 
        B.TotalGeneralDelPeriodo
    FROM (
        SELECT 
            fiscal.RazonSocial, 
            usuarios.Usuario, 
            facturas.id,
            CAST(CONCAT(LPAD(talonarios.NroSucursal,5,'0'),'-', LPAD(facturas.Numero,8,'0')) AS CHAR) AS Numero, 
            facturas.FechaCreacion,
            facturas.SubTotal AS SubTotal2, 
            facturas.Estado, 
            facturas.NroMoneda, 
            facturas.Total AS Total2,
            IF(
                facturas.NroMoneda = 1, 
                IF(facturas.Tipo = 0, facturas.Total, -facturas.Total), 
                IF(facturas.Tipo = 0, facturas.Total * monedacotizaciones.CotMoneda2, -(facturas.Total * monedacotizaciones.CotMoneda2))
            ) AS Total,
            IF(
                facturas.NroMoneda = 1, 
                IF(facturas.Tipo = 0, 
                    IF(facturas.TipoMultitipo = 2, (facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto), (facturas.SubTotal - facturas.ImporteDescuento)), 
                    IF(facturas.TipoMultitipo = 2, -(facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto), -(facturas.SubTotal - facturas.ImporteDescuento))
                ), 
                IF(facturas.Tipo = 0, 
                    IF(facturas.TipoMultitipo = 2, (facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto) * monedacotizaciones.CotMoneda2, (facturas.SubTotal - facturas.ImporteDescuento) * monedacotizaciones.CotMoneda2), 
                    IF(facturas.TipoMultitipo = 2, -((facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto) * monedacotizaciones.CotMoneda2), -((facturas.SubTotal - facturas.ImporteDescuento) * monedacotizaciones.CotMoneda2))
                )
            ) AS SubTotal
        FROM facturas
        JOIN fiscal ON fiscal.RecID = facturas.IDFiscal
        JOIN usuarios ON usuarios.RecID = facturas.IDUsuario
        JOIN talonarios ON talonarios.RecID = facturas.IDTalonario
        LEFT JOIN monedacotizaciones ON monedacotizaciones.RecID = facturas.IDCotizacionMoneda
        ${whereClause}
        ORDER BY facturas.Total DESC
    ) AS A,
    (
        SELECT 
            SUM(
                IF(f.NroMoneda = 1, 
                    IF(f.Tipo = 0, 
                        IF(f.TipoMultitipo = 2, (f.SubTotal - f.ImporteDescuento - f.Impuesto), (f.SubTotal - f.ImporteDescuento)), 
                        IF(f.TipoMultitipo = 2, -(f.SubTotal - f.ImporteDescuento - f.Impuesto), -(f.SubTotal - f.ImporteDescuento))
                    ), 
                    IF(f.Tipo = 0, 
                        IF(f.TipoMultitipo = 2, (f.SubTotal - f.ImporteDescuento - f.Impuesto) * m.CotMoneda2, (f.SubTotal - f.ImporteDescuento) * m.CotMoneda2), 
                        IF(f.TipoMultitipo = 2, -((f.SubTotal - f.ImporteDescuento - f.Impuesto) * m.CotMoneda2), -((f.SubTotal - f.ImporteDescuento) * m.CotMoneda2))
                    )
                )
            ) AS TotalGeneralDelPeriodo
        FROM facturas f
        LEFT JOIN monedacotizaciones m ON m.RecID = f.IDCotizacionMoneda
        WHERE 
            f.Estado IN (0, 1, 5)
            ${fechaDesde ? ' AND DATE(f.FechaCreacion) >= ?' : ''}
            ${fechaHasta ? ' AND DATE(f.FechaCreacion) <= ?' : ''}
    ) AS B;
    `;

    // Armamos de nuevo los valores para la subconsulta B también
    const allValues = [...values];
    if (fechaDesde) allValues.push(fechaDesde);
    if (fechaHasta) allValues.push(fechaHasta);

    pool.query(query, allValues, (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor', error: err.sqlMessage });
        }
        res.status(200).json(results);
    });
});
app.get('/api/busquedaFacturasChart', authenticateToken, (req, res) => {
    const { empresa, fechaDesde, fechaHasta } = req.query;

    const conditions = [];
    const values = [];

    if (empresa) {
        conditions.push("fiscal.RazonSocial LIKE ?");
        values.push(`%${empresa}%`);
    }
    if (fechaDesde) {
        conditions.push("DATE(fi.FechaEmision) >= ?");
        values.push(fechaDesde);
    }
    if (fechaHasta) {
        conditions.push("DATE(fi.FechaEmision) <= ?");
        values.push(fechaHasta);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const query = `
    SELECT 
  fi.Fabricante AS RazonSocial,

  (
    ((fi.ImportePrecio1) * (1 - (fi.Descuento / 100))) 
    * (1 - (fa.Descuento / 100))
  ) AS SubTotal
FROM facturasitems AS fi
JOIN facturas AS fa ON fa.RecID = fi.IDFactura
JOIN fiscal ON fiscal.RecID=fa.IDFiscal
        ${whereClause}
       
    `;

    // Armamos de nuevo los valores para la subconsulta B también
    const allValues = [...values];
    if (fechaDesde) allValues.push(fechaDesde);
    if (fechaHasta) allValues.push(fechaHasta);

    pool.query(query, allValues, (err, results) => {
        
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor', error: err.sqlMessage });
        }
        res.status(200).json(results);
    });
});

// app.get('/api/busquedaFacturas', authenticateToken, (req, res) => {
//     const { empresa, fechaDesde, fechaHasta } = req.query;

//     // Construye la consulta SQL dinámicamente
//     const conditions = [];
//     const values = [];

//     if (empresa) {
//         conditions.push("fiscal.RazonSocial LIKE ?");
//         values.push(`%${empresa}%`);
//     }
//     if (fechaDesde) {
//         conditions.push("DATE(facturas.FechaCreacion) >= ?");
//         values.push(fechaDesde);
//     }
//     if (fechaHasta) {
//         conditions.push("DATE(facturas.FechaCreacion) <= ?");
//         values.push(fechaHasta);
//     }

//     // Agrega condiciones de Estado
//     conditions.push("(facturas.Estado = 0 OR facturas.Estado = 1 OR facturas.Estado = 5)");

//     const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

//     const query = `
//         SELECT fiscal.RazonSocial, usuarios.Usuario, facturas.id,
// CAST(CONCAT(LPAD(talonarios.NroSucursal,5,0),'-', LPAD(facturas.Numero,8,0)) AS CHAR) AS Numero, facturas.FechaCreacion,
// facturas.SubTotal as SubTotal2, facturas.Estado, facturas.NroMoneda, facturas.Total AS Total2,
// IF(
//     facturas.NroMoneda = 1, 
//     IF(facturas.Tipo = 0, facturas.Total, -facturas.Total), 
//     IF(facturas.Tipo = 0, facturas.Total * monedacotizaciones.CotMoneda2, -(facturas.Total * monedacotizaciones.CotMoneda2))
// ) AS Total,
// IF(
//     facturas.NroMoneda = 1, 
//     IF(facturas.Tipo = 0, 
//         IF(facturas.TipoMultitipo = 2, (facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto), (facturas.SubTotal - facturas.ImporteDescuento)), 
//         IF(facturas.TipoMultitipo = 2, -(facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto), -(facturas.SubTotal - facturas.ImporteDescuento))
//     ), 
//     IF(facturas.Tipo = 0, 
//         IF(facturas.TipoMultitipo = 2, (facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto) * monedacotizaciones.CotMoneda2, (facturas.SubTotal - facturas.ImporteDescuento) * monedacotizaciones.CotMoneda2), 
//         IF(facturas.TipoMultitipo = 2, -((facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto) * monedacotizaciones.CotMoneda2), -((facturas.SubTotal - facturas.ImporteDescuento) * monedacotizaciones.CotMoneda2))
//     )
// ) AS SubTotal
// FROM facturas
// JOIN fiscal ON fiscal.RecID=facturas.IDFiscal
// JOIN usuarios ON usuarios.RecID=facturas.IDUsuario
// JOIN talonarios ON talonarios.RecID=facturas.IDTalonario
// LEFT JOIN monedacotizaciones ON monedacotizaciones.RecID= facturas.IDCotizacionMoneda
// ${whereClause} ORDER BY facturas.total desc;
//     `;

//     pool.query(query, values, (err, results) => {
//         if (err) {
//             console.error('Error al ejecutar la consulta:', err);
//             return res.status(500).json({ message: 'Error interno del servidor', error: err.sqlMessage });
//         }
//         res.status(200).json(results);
//     });
// });
app.get('/api/detalleCC/:cuit', authenticateToken, (req, res) => {
    const { cuit } = req.params; // Extrae el ID de los parámetros de la URL
    const query = `
SELECT a.factura as 'Factura', 
                CAST(DATE_FORMAT(a.fecha, '%d/%m/%Y') AS CHAR) as 'FechaEmision', 
                CAST(DATE_FORMAT(a.vto, '%d/%m/%Y') AS CHAR) as 'FechaVencimiento', 
                IF(a.tipo=1,-ABS(a.importe),a.importe2) AS 'Importe', 
                IF(a.tipo=1,-ABS(a.importe2 - IFNULL(b.Saldo,0)), (a.importe2 - IFNULL(b.Saldo,0))) AS 'Saldo', 
                a.estado as 'Estado', 
                a.Moneda, 
                a.id,a.recid, a.razonsocial
            FROM 
            (SELECT fiscal.RazonSocial, 
                CONVERT(CONCAT(LPAD(talonarios.NroSucursal,5,'0'), '-', LPAD(facturas.Numero,8,'0')),CHAR) as 'Factura', 
                DATE(facturas.FechaCreacion) AS 'Fecha', 
                DATE(facturas.FechaVencimiento) AS 'Vto', 
                facturas.Total AS 'Importe',
                facturas.RecID, 
                IF(facturas.NroMoneda=1,'$','u$s') AS 'Moneda', 
                monedacotizaciones.CotMoneda2, 
                IF(facturas.NroMoneda=1, facturas.total, (monedacotizaciones.CotMoneda2 * facturas.total)) AS 'Importe2', 
                IF(facturas.FechaVencimiento<CURDATE(),'Vencido','A Vencer') AS 'Estado', 
                facturas.Tipo,  
                facturas.ID
            FROM facturas 
            LEFT JOIN fiscal ON fiscal.recid=facturas.IDFiscal 
            LEFT JOIN talonarios ON talonarios.RecID=facturas.IDTalonario 
            LEFT JOIN monedacotizaciones ON monedacotizaciones.RecID=facturas.IDCotizacionMoneda 
            WHERE facturas.Estado=0 AND facturas.total>10 AND fiscal.NroImpuesto1= ? and 
                facturas.FechaCreacion >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)) AS A 
            LEFT JOIN 
            (SELECT sum(comprobantespagos.importe1) AS 'Saldo', facturas.recid, 
            if(facturas.NroMoneda=2,(sum(comprobantespagos.importe1)/monedacotizaciones.CotMoneda2),sum(comprobantespagos.importe1)) AS 'CotMoneda2'
            FROM comprobantespagos 
            LEFT JOIN facturas ON facturas.RecID=comprobantespagos.IDREF 
            LEFT JOIN fiscal ON fiscal.RecID=facturas.IDFiscal 
            LEFT JOIN recibos ON recibos.RecID=comprobantespagos.idtipo 
            LEFT JOIN monedacotizaciones ON monedacotizaciones.RecID= comprobantespagos.IDCotizacionMoneda
            WHERE facturas.Estado=0 and (recibos.estado<>2 or recibos.estado is null) GROUP BY facturas.RecID) B 
            ON A.recid=B.recid 
            WHERE (a.importe2- ifnull(b.Saldo,0)>'10') 
            ORDER BY a.razonsocial asc;
    `;

    pool.query(query, [cuit], (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results);
    });
});
app.get("/api/buscarEmpresas", authenticateToken, async (req, res) => {
    const { search } = req.query;

    if (!search) {
        return res.status(400).json({ error: "El parámetro 'search' es requerido." });
    }

    const query = `SELECT empresas.recid, empresas.empresa, fiscal.NroImpuesto1 as cuit
FROM empresas 
JOIN fiscal ON fiscal.IDRef=empresas.IDEmpresa AND fiscal.Defecto=1
 WHERE empresa LIKE ?`;

    // Agregar los porcentajes al valor de búsqueda
    const searchPattern = `%${search}%`;

    pool.query(query, [searchPattern], (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results);
    });
});
app.get('/api/busquedaPedidosEmpresa/:cuit', authenticateToken, (req, res) => {
    const { cuit } = req.params;
    console.log(cuit)
    const query =
        `SELECT 
            fiscal.RazonSocial, 
            pedidos.Total, 
            usuarios.Usuario, 
            pedidos.NroMoneda, 
            pedidos.fechacreacion, 
            pedidos.numero, 
            pedidos.id,
            pedidos.estado,
            pedidos.escenario
        FROM pedidos
        JOIN fiscal ON fiscal.RecID = pedidos.IDFiscal
        JOIN usuarios ON usuarios.recid = pedidos.IDUsuarioCreacion
        JOIN empresas ON empresas.IDEmpresa=fiscal.IDRef
        WHERE fiscal.NroImpuesto1=?
        ORDER BY pedidos.FechaCreacion DESC
        LIMIT 200`
        ;

    pool.query(query, [cuit], (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results);
        console.log(results)
    });
});
app.get('/api/busquedaPresupuestosEmpresa/:cuit', authenticateToken, (req, res) => {
    const { cuit } = req.params;
    const query =
        `SELECT  fiscal.RazonSocial, 
            presupuestos.Total, 
            usuarios.Usuario, 
            presupuestos.NroMoneda, 
            presupuestos.fechacreacion, 
            presupuestos.id,
            presupuestos.estado,
            presupuestos.escenario
FROM presupuestos
JOIN contactos ON contactos.IDContacto=presupuestos.IDRef
JOIN empresas ON empresas.IDEmpresa=contactos.IDEmpresa
JOIN fiscal ON fiscal.IDRef=empresas.IDEmpresa
JOIN usuarios ON usuarios.recid = presupuestos.IDUsuarioCreacion
WHERE fiscal.NroImpuesto1=?
ORDER BY presupuestos.FechaCreacion DESC
LIMIT 200`
        ;

    pool.query(query, [cuit], (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results);
        console.log(results)
    });
});
app.get('/api/busquedaFacturasEmpresa/:cuit', authenticateToken, (req, res) => {
    const { cuit } = req.params;
    const query =
        ` SELECT 
    CAST(CONCAT(LPAD(talonarios.NroSucursal,5,0),'-',LPAD(facturas.Numero,8,0)) AS CHAR) AS Numero,
    fiscal.RazonSocial, 
    usuarios.Usuario, 
    facturas.fechacreacion, 
    facturas.nromoneda, facturas.id, facturas.total,
    CASE  
        WHEN facturas.tipo = 0 THEN facturas.Total
        WHEN facturas.tipo = 1 THEN -(facturas.Total)
        ELSE 0 
    END AS fact
FROM facturas
JOIN fiscal ON fiscal.RecID = facturas.IDFiscal
JOIN usuarios ON usuarios.recid = facturas.IDUsuario
JOIN talonarios ON talonarios.RecID=facturas.IDTalonario
WHERE fiscal.NroImpuesto1=?
ORDER BY facturas.FechaCreacion DESC
LIMIT 200`
        ;

    pool.query(query, [cuit], (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results);
        console.log(results)
    });
});
app.get('/api/chartEmpresa/:cuit', authenticateToken, (req, res) => {
    const { cuit } = req.params;
    const query =
        `SELECT 
    CASE MONTH(facturas.FechaCreacion)
        WHEN 1 THEN 'Ene'
        WHEN 2 THEN 'Feb'
        WHEN 3 THEN 'Mar'
        WHEN 4 THEN 'Abr'
        WHEN 5 THEN 'May'
        WHEN 6 THEN 'Jun'
        WHEN 7 THEN 'Jul'
        WHEN 8 THEN 'Agos'
        WHEN 9 THEN 'Sept'
        WHEN 10 THEN 'Oct'
        WHEN 11 THEN 'Nov'
        WHEN 12 THEN 'Dic'
    END AS Mes,
    SUM(facturas.Total) AS SumaTotal_chart,
     CASE 
        WHEN SUM(facturas.Total) >= 1000000 THEN CONCAT(FORMAT(SUM(facturas.Total) / 1000000, 1), ' mill') 
        WHEN SUM(facturas.Total) >= 1000 THEN CONCAT(FORMAT(SUM(facturas.Total) / 1000, 0), ' mil')
        ELSE FORMAT(SUM(facturas.Total), 2)
    END AS SumaTotal
FROM facturas
JOIN fiscal ON fiscal.RecID = facturas.IDFiscal
WHERE fiscal.NroImpuesto1 = '20-21587499-1'
  AND facturas.FechaCreacion >= DATE_SUB(CURDATE(), INTERVAL 2 MONTH)
GROUP BY MONTH(facturas.FechaCreacion)
ORDER BY MONTH(facturas.FechaCreacion) DESC;`
        ;

    pool.query(query, [cuit], (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results);
        console.log(results)
    });
});
app.get("/api/buscarCodigo", authenticateToken, async (req, res) => {
    const { search } = req.query;

    if (!search) {
        return res.status(400).json({ error: "El parámetro 'search' es requerido." });
    }

    const query = `
      SELECT Codigo, Descripcion, CodigoFabricante from productos WHERE codigo LIKE ? AND productos.estado=0 AND productos.Inhabilitado=0
      LIMIT 10
    `;

    // Agregar los porcentajes al valor de búsqueda
    const searchPattern = `%${search}%`;

    // Verifica los parámetros en el query
    pool.query(query, [searchPattern, searchPattern], (err, results) => {
        if (err) {
            console.error("Error al ejecutar la consulta:", err);
            return res.status(500).json({ message: "Error interno del servidor" });
        }
        console.log(results)
        res.status(200).json(results);
    });
});
app.get("/api/buscarCodigoDetalle", authenticateToken, async (req, res) => {
    const { search } = req.query;

    if (!search) {
        return res.status(400).json({ error: "El parámetro 'search' es requerido." });
    }
    
    const query = `
    SELECT 
        a.Codigo, 
        a.Descripcion, 
        ROUND(IF(a.fabricante = 'YUKEN KOGYO CO.,LTD.', b.Precio, 
        (IFNULL(a.PrecioArmado, b.Precio))), 2) AS 'Precio', 
        a.Recid,  
        IF(a.codtransporte = '', 'sin', CONCAT('https://portal-distritec.com.ar/', a.codtransporte)) AS catalogo, 
        b.NroMonedaPrecio, 
        c.Stock AS Stock_Gral, 
        d.total_pedido, 
        IFNULL((c.Stock - d.total_pedido),0) AS Stock, a.CodigoFabricante
      FROM 
        (SELECT 
          productos.Codigo, 
          productos.Descripcion, 
          SUM(productosinsumos.Cantidad * productosprecios.Precio) AS 'PrecioArmado', 
          productos.Recid, 
          productos.TipoProducto, 
          productos.Fabricante, 
          productosprecios.NroLista,
          ROUND(productosprecios.Precio * (SELECT cotmoneda2 FROM monedacotizaciones ORDER BY fechahora DESC LIMIT 1), 2) AS 'Precio2', 
          productos.CodigoFabricante, 
          productos.Nombre, 
          productos.codtransporte, 
          productos.descripcion3
        FROM 
          productos
        LEFT JOIN 
          productosinsumos 
          ON productosinsumos.IDProducto = productos.RecID
        LEFT JOIN 
          productosprecios 
          ON productosprecios.IDProducto = productosinsumos.IDProductoInsumo
        WHERE 
          productos.codigo LIKE ?   
          AND productos.Inhabilitado = 0 
          AND productos.estado = 0 
          AND productos.Fabricante <> 'GRUPO TORNADO S.A.'
        GROUP BY 
          productos.recid) AS A
      LEFT JOIN 
        (SELECT 
          productosprecios.Precio AS 'Precio', 
          productos.Recid, 
          productosprecios.NroMonedaPrecio
        FROM 
          productos
        LEFT JOIN 
          productosprecios 
          ON productosprecios.IDProducto = productos.RecID
        WHERE  
          productos.codigo LIKE ? 
          AND productos.Inhabilitado = 0  
          AND productosprecios.Precio <> 0 
        ORDER BY 
          productos.Codigo DESC) AS B
      ON 
        A.RECID = B.RECID
      LEFT JOIN
        (SELECT 
          SUM(CASE productosstockmovimientos.TIPO
            WHEN 0 THEN (productosstockmovimientos.cantidad * productosstockmovimientos.Equivalencia)
            WHEN 1 THEN -(productosstockmovimientos.cantidad * productosstockmovimientos.Equivalencia)
            WHEN 2 THEN -(productosstockmovimientos.cantidad * productosstockmovimientos.Equivalencia)
            WHEN 3 THEN (productosstockmovimientos.cantidad * productosstockmovimientos.Equivalencia) 
            ELSE 0 
          END) AS 'Stock', 
          productos.recid
        FROM 
          productos
        LEFT JOIN 
          productosstock 
          ON (productosstock.idproducto = productos.recid)
        LEFT JOIN 
          productosstockmovimientos 
          ON (productosstockmovimientos.idproducto = productos.recid)
        WHERE productos.codigo LIKE ? AND
          (productosstock.controlastock = 1 
          AND productosstockmovimientos.tipo <> 2
          AND productosstockmovimientos.tipo <> 3 
          OR productosstockmovimientos.tipo IS NULL)
        GROUP BY 
          productos.recid) AS C
      ON 
        A.RECID = C.RECID
      LEFT JOIN
        (SELECT 
          SUM(CAST(pedidositems.escenario AS DECIMAL)) AS total_pedido, 
          pedidositems.IDProducto
        FROM 
          pedidositems
        WHERE pedidositems.Codigo LIKE ? AND
          pedidositems.Estado = 0
        GROUP BY 
          pedidositems.IDProducto) AS D
      ON 
        A.RECID = D.IDProducto
      GROUP BY 
        a.recid
    `

    // const query = `
    //   SELECT 
    //     a.Codigo, 
    //     a.Descripcion, 
    //     ROUND(IF(a.fabricante = 'YUKEN KOGYO CO.,LTD.', b.Precio, 
    //     (IFNULL(a.PrecioArmado, b.Precio))), 2) AS 'Precio', 
    //     a.Recid,  
    //     IF(a.codtransporte = '', 'sin', CONCAT('https://portal-distritec.com.ar/', a.codtransporte)) AS catalogo, 
    //     b.NroMonedaPrecio, 
    //     c.Stock AS Stock_Gral, 
    //     d.total_pedido, 
    //     IFNULL((c.Stock - d.total_pedido),0) AS Stock, a.CodigoFabricante
    //   FROM 
    //     (SELECT 
    //       productos.Codigo, 
    //       productos.Descripcion, 
    //       SUM(productosinsumos.Cantidad * productosprecios.Precio) AS 'PrecioArmado', 
    //       productos.Recid, 
    //       productos.TipoProducto, 
    //       productos.Fabricante, 
    //       productosprecios.NroLista,
    //       ROUND(productosprecios.Precio * (SELECT cotmoneda2 FROM monedacotizaciones ORDER BY fechahora DESC LIMIT 1), 2) AS 'Precio2', 
    //       productos.CodigoFabricante, 
    //       productos.Nombre, 
    //       productos.codtransporte, 
    //       productos.descripcion3
    //     FROM 
    //       productos
    //     LEFT JOIN 
    //       productosinsumos 
    //       ON productosinsumos.IDProducto = productos.RecID
    //     LEFT JOIN 
    //       productosprecios 
    //       ON productosprecios.IDProducto = productosinsumos.IDProductoInsumo
    //     WHERE 
    //       productos.codigo LIKE ?  
    //       AND productos.Inhabilitado = 0 
    //       AND productos.estado = 0 
    //       AND productos.Fabricante <> 'GRUPO TORNADO S.A.'
    //     GROUP BY 
    //       productos.recid) AS A
    //   LEFT JOIN 
    //     (SELECT 
    //       productosprecios.Precio AS 'Precio', 
    //       productos.Recid, 
    //       productosprecios.NroMonedaPrecio
    //     FROM 
    //       productos
    //     LEFT JOIN 
    //       productosprecios 
    //       ON productosprecios.IDProducto = productos.RecID
    //     WHERE  
    //       productos.codigo LIKE ? 
    //       AND productos.Inhabilitado = 0  
    //       AND productosprecios.Precio <> 0 
    //     ORDER BY 
    //       productos.Codigo DESC) AS B
    //   ON 
    //     A.RECID = B.RECID
    //   LEFT JOIN
    //     (SELECT 
    //       SUM(CASE productosstockmovimientos.TIPO
    //         WHEN 0 THEN (productosstockmovimientos.cantidad * productosstockmovimientos.Equivalencia)
    //         WHEN 1 THEN -(productosstockmovimientos.cantidad * productosstockmovimientos.Equivalencia)
    //         WHEN 2 THEN -(productosstockmovimientos.cantidad * productosstockmovimientos.Equivalencia)
    //         WHEN 3 THEN (productosstockmovimientos.cantidad * productosstockmovimientos.Equivalencia) 
    //         ELSE 0 
    //       END) AS 'Stock', 
    //       productos.recid
    //     FROM 
    //       productos
    //     LEFT JOIN 
    //       productosstock 
    //       ON (productosstock.idproducto = productos.recid)
    //     LEFT JOIN 
    //       productosstockmovimientos 
    //       ON (productosstockmovimientos.idproducto = productos.recid)
    //     WHERE 
    //       (productosstock.controlastock = 1 
    //       AND productosstockmovimientos.tipo <> 2
    //       AND productosstockmovimientos.tipo <> 3 
    //       OR productosstockmovimientos.tipo IS NULL)
    //     GROUP BY 
    //       productos.recid) AS C
    //   ON 
    //     A.RECID = C.RECID
    //   LEFT JOIN
    //     (SELECT 
    //       SUM(CAST(pedidositems.escenario AS DECIMAL)) AS total_pedido, 
    //       pedidositems.IDProducto
    //     FROM 
    //       pedidositems
    //     WHERE 
    //       pedidositems.Estado = 0
    //     GROUP BY 
    //       pedidositems.IDProducto) AS D
    //   ON 
    //     A.RECID = D.IDProducto
    //   GROUP BY 
    //     a.recid 
    // `;
    const searchPattern = `%${search}%`;

    // Verifica los parámetros en el query
    pool.query(query, [searchPattern, searchPattern, searchPattern, searchPattern], (err, results) => {
        if (err) {
            console.error("Error al ejecutar la consulta:", err);
            return res.status(500).json({ message: "Error interno del servidor" });
        }
        res.status(200).json(results);
        console.log(results)
    });
});
app.get("/api/buscarMovimientoDetalle", authenticateToken, async (req, res) => {
    const { search } = req.query;

    if (!search) {
        return res.status(400).json({ error: "El parámetro 'search' es requerido." });
    }

    const query = `
      SELECT p.Motivo, p.Cantidad, p.Fecha, p.id, usuarios.Usuario
FROM productosstockmovimientos AS p
JOIN productos ON productos.RecID=P.IDProducto
JOIN usuarios ON usuarios.RecID=p.IDUsuario
WHERE productos.Codigo= ?
ORDER BY p.Fecha DESC
LIMIT 50
    `;

    // Verifica los parámetros en el query
    pool.query(query, [search], (err, results) => {
        if (err) {
            console.error("Error al ejecutar la consulta:", err);
            return res.status(500).json({ message: "Error interno del servidor" });
        }
        res.status(200).json(results);
        console.log(results)
    });
});
app.get("/api/buscarRequeimientoDetalle", authenticateToken, async (req, res) => {
    const { search } = req.query;

    if (!search) {
        return res.status(400).json({ error: "El parámetro 'search' es requerido." });
    }

    const query = `
      SELECT requerimientos.Numero, requerimientos.FechaCreacion, requerimientos.Estado, requerimientositems.Cantidad
FROM requerimientos
JOIN requerimientositems ON requerimientositems.IDRequerimiento=requerimientos.RecID
WHERE requerimientositems.Codigo= ?
ORDER BY requerimientos.FechaCreacion DESC
LIMIT 10
    `;

    // Verifica los parámetros en el query
    pool.query(query, [search], (err, results) => {
        if (err) {
            console.error("Error al ejecutar la consulta:", err);
            return res.status(500).json({ message: "Error interno del servidor" });
        }
        res.status(200).json(results);
        console.log(results)
    });
});
app.get('/api/objetivos', authenticateToken, (req, res) => {
    console.log("mes")

    const idusuario = req.user.userId;
    const mes = parseInt(req.query.mes);

    if (!mes || isNaN(mes)) {
        return res.status(400).json({ message: 'Parámetro "mes" es requerido y debe ser numérico.' });
    }

    const queryDiarios = `SELECT * FROM objetivosdiarios WHERE idusuario = ?`;

    const queryMensual = `
        SELECT * FROM objetivomensual 
        WHERE idusuario = ? AND mes = ? AND modulo IN (1, 2, 4)
    `;

    pool.query(queryDiarios, [idusuario], (err, diariosResult) => {
        if (err) {
            console.error('Error al obtener objetivos diarios:', err);
            return res.status(500).json({ message: 'Error interno al obtener diarios' });
        }

        pool.query(queryMensual, [idusuario, mes], (err2, mensualResult) => {
            if (err2) {
                console.error('Error al obtener objetivos mensuales:', err2);
                return res.status(500).json({ message: 'Error interno al obtener mensuales' });
            }

            // Agrupar resultados por módulo
            const mensual = {
                facturacion: mensualResult.find(row => row.modulo === 1) || {},
                pedidos: mensualResult.find(row => row.modulo === 2) || {},
                requerimientos: mensualResult.find(row => row.modulo === 4) || {},
            };

            res.status(200).json({
                objetivos: {
                    diario: diariosResult[0] || {},
                    mensual
                }
            });
        });
    });
});
app.get('/api/objetivoMesSeleccion', authenticateToken, (req, res) => {
    const idusuario = req.user.userId;
    const mes = parseInt(req.query.mes);
    const modulo = parseInt(req.query.modulo);

    const query = `SELECT * FROM objetivomensual WHERE idusuario=? AND mes=? AND modulo=?`;

    pool.query(query, [idusuario, mes, modulo], (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        res.status(200).json(results[0]);
    });
});
app.get('/api/datosUser', authenticateToken, (req, res) => {
    const idusuario = req.user.userId;


    const query = `SELECT * FROM usersapp WHERE id= ?`;

    pool.query(query, [idusuario], (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
        console.log(results)
        res.status(200).json(results);
    });
});
app.post("/api/saveObjetivoMes", authenticateToken, async (req, res) => {
    const idusuario = req.user.userId;
    const { key: modulo, value, mes } = req.body;

    try {
        // Primero comprobamos si ya existe el registro
        const [rows] = await pool.promise().execute(
            `SELECT id FROM objetivomensual WHERE idusuario = ? AND mes = ? AND modulo = ?`,
            [idusuario, mes, modulo]
        );

        if (rows.length > 0) {
            // Si existe, actualizamos
            await pool.promise().execute(
                `UPDATE objetivomensual SET valor = ? WHERE idusuario = ? AND mes = ? AND modulo = ?`,
                [value, idusuario, mes, modulo]
            );
            res.status(200).json({ message: `Objetivo actualizado correctamente` });
        } else {
            // Si no existe, insertamos
            await pool.promise().execute(
                `INSERT INTO objetivomensual (idusuario, mes, modulo, valor) VALUES (?, ?, ?, ?)`,
                [idusuario, mes, modulo, value]
            );
            res.status(201).json({ message: `Objetivo creado correctamente` });
        }
    } catch (error) {
        console.error("Error al guardar el objetivo:", error);
        res.status(500).json({ message: "Error interno del servidor" });
    }
});

// app.get('/api/objetivos', authenticateToken, (req, res) => {
//     const idusuario = req.user.userId;

//     const query = `SELECT * FROM objetivosdiarios WHERE idusuario=?`;

//     pool.query(query, [idusuario], (err, results) => {
//         if (err) {
//             console.error('Error al ejecutar la consulta:', err);
//             return res.status(500).json({ message: 'Error interno del servidor' });
//         }
//         res.status(200).json(results[0]);
//     });
// });

app.post("/api/saveObjetivo", authenticateToken, async (req, res) => {
    const idusuario = req.user.userId;
    const { key, value } = req.body;
    console.log(`Clave: ${key}, Valor: ${value}, Usuario: ${idusuario}`);

    let campo = "";

    if (key === "objdiariopedidos") {
        campo = "pedidos"
    } else if (key === "obdiariopresupuestos") {
        campo = "presupuestos"
    } else if (key === "obdiariofacturas") {
        campo = "facturas"
    }

    if (!key || value === undefined) {
        return res.status(400).json({ message: "La clave y el valor son requeridos" });
    }

    try {
        const query = `UPDATE objetivosdiarios SET ${campo} = ? WHERE idusuario = ?`;
        const [result] = await pool.promise().execute(query, [value, idusuario]);

        if (result.affectedRows > 0) {
            res.status(200).json({ message: `Objetivo ${key} actualizado correctamente` });
        } else {
            res.status(200).json({ message: `No se encontró el registro para actualizar o ya está actualizado` });

        }
    } catch (error) {
        console.error("Error al actualizar el objetivo:", error);
        res.status(500).json({ message: "Error interno del servidor" });
    }
});
app.get('/api/detalleProductoSeleccionado', authenticateToken, (req, res) => {
    const { codigo, fechaDesde, fechaHasta } = req.query;

    const query = `
        SELECT
            IFNULL((
                SELECT SUM(ri.cantidad) 
                FROM requerimientositems ri
                JOIN requerimientos r ON r.RecID = ri.IDRequerimiento 
                WHERE ri.Codigo = ? AND DATE(r.FechaCreacion) BETWEEN ? AND ?
            ),0) AS Cant_req,

            IFNULL((
                SELECT SUM(ri.ImportePrecio1) 
                FROM requerimientositems ri
                JOIN requerimientos r ON r.RecID = ri.IDRequerimiento 
                WHERE ri.Codigo = ? AND DATE(r.FechaCreacion) BETWEEN ? AND ?
            ),0) AS SubTotal_req,

            fiscal.RazonSocial, 
            usuarios.Usuario, 
            facturas.id,
            CAST(CONCAT(LPAD(talonarios.NroSucursal,5,'0'),'-', LPAD(facturas.Numero,8,'0')) AS CHAR) AS Numero, 
            facturas.FechaCreacion,
            facturas.SubTotal AS SubTotal2, 
            facturas.Estado, 
            facturas.NroMoneda,

            IF(
                facturas.NroMoneda = 1, 
                IF(facturas.Tipo = 0, 
                    IF(facturas.TipoMultitipo = 2, (facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto), (facturas.SubTotal - facturas.ImporteDescuento)), 
                    IF(facturas.TipoMultitipo = 2, -(facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto), -(facturas.SubTotal - facturas.ImporteDescuento))
                ), 
                IF(facturas.Tipo = 0, 
                    IF(facturas.TipoMultitipo = 2, (facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto) * monedacotizaciones.CotMoneda2, (facturas.SubTotal - facturas.ImporteDescuento) * monedacotizaciones.CotMoneda2), 
                    IF(facturas.TipoMultitipo = 2, -((facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto) * monedacotizaciones.CotMoneda2), -((facturas.SubTotal - facturas.ImporteDescuento) * monedacotizaciones.CotMoneda2))
                )
            ) AS SubTotal,

            SUM(facturasitems.Cantidad) AS TotalCantidad,
            SUM(facturasitems.ImportePrecio1) AS TotalImportePrecio1

        FROM facturas
        JOIN facturasitems ON facturasitems.IDFactura = facturas.recid
        JOIN fiscal ON fiscal.RecID = facturas.IDFiscal
        JOIN usuarios ON usuarios.RecID = facturas.IDUsuario
        JOIN talonarios ON talonarios.RecID = facturas.IDTalonario
        LEFT JOIN monedacotizaciones ON monedacotizaciones.RecID = facturas.IDCotizacionMoneda

        WHERE 
            facturasitems.Codigo = ? AND 
            DATE(facturas.FechaCreacion) BETWEEN ? AND ? AND
            facturas.Estado IN (0, 1, 5)

        GROUP BY 
            facturas.recid,
            fiscal.RazonSocial, 
            usuarios.Usuario, 
            facturas.id, 
            talonarios.NroSucursal, 
            facturas.Numero, 
            facturas.FechaCreacion, 
            facturas.SubTotal, 
            facturas.Estado, 
            facturas.NroMoneda, 
            facturas.Tipo, 
            facturas.TipoMultitipo, 
            facturas.ImporteDescuento, 
            facturas.Impuesto, 
            monedacotizaciones.CotMoneda2

        ORDER BY facturas.Total DESC
    `;

    const allValues = [
        codigo, fechaDesde, fechaHasta, // Subquery Cant_req
        codigo, fechaDesde, fechaHasta, // Subquery SubTotal_req
        codigo, fechaDesde, fechaHasta  // Main query
    ];

    pool.query(query, allValues, (err, results) => {
        if (err) {
            console.error('Error al ejecutar la consulta:', err);
            return res.status(500).json({ message: 'Error interno del servidor', error: err.sqlMessage });
        }

        res.status(200).json(results);
    });
});
app.get('/api/facturasmes', authenticateToken, (req, res) => {
    const idusuario = req.user.userId;
    const mes = parseInt(req.query.mes);
    const modulo1 = 1;
    const modulo2 = 2;
    const modulo4 = 4;
    console.log(idusuario)

    const facturasQuery = `
        SELECT
            (
                SELECT 
                    SUM( IF(
                        facturas.NroMoneda = 1, 
                        IF(facturas.Tipo = 0, 
                            IF(facturas.TipoMultitipo = 2, (facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto), (facturas.SubTotal - facturas.ImporteDescuento)), 
                            IF(facturas.TipoMultitipo = 2, -(facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto), -(facturas.SubTotal - facturas.ImporteDescuento))
                        ), 
                        IF(facturas.Tipo = 0, 
                            IF(facturas.TipoMultitipo = 2, (facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto) * monedacotizaciones.CotMoneda2, (facturas.SubTotal - facturas.ImporteDescuento) * monedacotizaciones.CotMoneda2), 
                            IF(facturas.TipoMultitipo = 2, -((facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto) * monedacotizaciones.CotMoneda2), -((facturas.SubTotal - facturas.ImporteDescuento) * monedacotizaciones.CotMoneda2))
                        )
                    )) 
                FROM facturas
                LEFT JOIN monedacotizaciones ON monedacotizaciones.RecID = facturas.IDCotizacionMoneda
                WHERE facturas.Estado IN (0, 1, 5) AND MONTH(facturas.FechaCreacion) = ? AND YEAR(facturas.FechaCreacion) = YEAR(CURDATE())
            ) AS suma_facturas,
            (
                SELECT COUNT(*) 
                FROM facturas
                WHERE MONTH(facturas.FechaCreacion) = ?
                  AND YEAR(facturas.FechaCreacion) = YEAR(CURDATE()) 
                  AND facturas.Estado IN (0, 1, 5)
            ) AS cantidad_facturas,
            (
                SELECT valor 
                FROM objetivomensual 
                WHERE idusuario = ? AND modulo = ? AND mes = ?
            ) AS objetivo_facturas
    `;

    const pedidosQuery = `
        SELECT
            SUM(suma) AS suma_pedidos,
            SUM(cantidad) AS cantidad_pedidos,
            (
                SELECT valor 
                FROM objetivomensual 
                WHERE idusuario = ? AND modulo = ? AND mes = ?
            ) AS objetivo_pedidos
        FROM resumen_pedidos 
        WHERE MONTH(creado_en) = ? AND YEAR(creado_en) = YEAR(CURDATE())
    `;

    const presupuestosQuery = `
        SELECT   
            IF (presupuestos.NroMoneda=1, presupuestos.SubTotal2, presupuestos.SubTotal2 * monedacotizaciones.CotMoneda2) AS subtotal,
            presupuestos.estado
        FROM presupuestos
        JOIN presupuestositems ON presupuestositems.IDPresupuesto = presupuestos.RecID
        JOIN contactos ON contactos.IDContacto = presupuestos.IDRef
        JOIN empresas ON empresas.IDEmpresa = contactos.IDEmpresa
        JOIN fiscal ON fiscal.IDRef = empresas.IDEmpresa AND fiscal.Defecto = 1
        JOIN usuarios ON usuarios.recid = presupuestos.IDUsuarioCreacion
        LEFT JOIN monedacotizaciones ON monedacotizaciones.RecID = presupuestositems.IDCotizacionMoneda
        WHERE MONTH(presupuestos.FechaCreacion) = ? 
          AND YEAR(presupuestos.FechaCreacion) = YEAR(CURDATE())
          AND presupuestos.Estado <> 2
        GROUP BY presupuestos.RecID
        ORDER BY presupuestos.FechaCreacion DESC
    `;

    const requerimientosQuery = `
        SELECT 
            SUM(requerimientos.SubTotal2) AS subtotal,
            (
                SELECT valor 
                FROM objetivomensual 
                WHERE modulo = ? AND idusuario = ?  AND mes = ?
    LIMIT 1
            ) AS objetivo
        FROM requerimientos 
        JOIN fiscal ON fiscal.recid = requerimientos.IDFiscal
        WHERE fiscal.RazonSocial = 'AUTOMAC.MICROMECANICA S.A.I.C.'
          AND MONTH(requerimientos.FechaCreacion) = ?
          AND YEAR(requerimientos.FechaCreacion) = YEAR(CURDATE())
    `;

    const facturasParams = [mes, mes, idusuario, modulo1, mes];
    const pedidosParams = [idusuario, modulo2, mes, mes];
    const presupuestosParams = [mes];
    const requerimientosParams = [modulo4, idusuario, mes, mes];

    const facturasPromise = new Promise((resolve, reject) => {
        pool.query(facturasQuery, facturasParams, (err, results) => {
            if (err) return reject(err);
            resolve(results[0]);
        });
    });

    const pedidosPromise = new Promise((resolve, reject) => {
        pool.query(pedidosQuery, pedidosParams, (err, results) => {
            if (err) return reject(err);
            resolve(results[0]);
        });
    });

    const presupuestosPromise = new Promise((resolve, reject) => {
        pool.query(presupuestosQuery, presupuestosParams, (err, results) => {
            if (err) return reject(err);
            resolve(results);
        });
    });

    const requerimientosPromise = new Promise((resolve, reject) => {
        pool.query(requerimientosQuery, requerimientosParams, (err, results) => {
            if (err) return reject(err);
            resolve(results[0]);
        });
    });

    Promise.all([facturasPromise, pedidosPromise, presupuestosPromise, requerimientosPromise])
        .then(([facturas, pedidos, presupuestos, requerimientos]) => {
            res.status(200).json({
                facturas,
                pedidos,
                presupuestos,
                requerimientos
            });
        })
        .catch(err => {
            console.error('Error al ejecutar una de las consultas:', err);
            res.status(500).json({ message: 'Error interno del servidor' });
        });
});
app.get('/api/home', authenticateToken, (req, res) => {
    const idusuario = req.user.userId;
   

    const queries = {
        facturas: `
            SELECT
                (SELECT 
                    ROUND(
                        SUM(
                            CASE 
                                WHEN facturas.tipo = 1 THEN
                                    CASE
                                        WHEN facturas.NroMoneda = 1 THEN 
                                            IF(facturas.TipoMultitipo=2,-(facturas.subtotal - Impuesto), -facturas.Subtotal)
                                        WHEN facturas.NroMoneda = 2 THEN 
                                            IF(facturas.TipoMultitipo=2,-(facturas.subtotal - Impuesto), -facturas.Subtotal) * (
                                                SELECT cotmoneda2 FROM monedacotizaciones ORDER BY fechahora DESC LIMIT 1
                                            )
                                        WHEN facturas.NroMoneda = 3 THEN 
                                            -facturas.Subtotal * (
                                                SELECT cotmoneda3 FROM monedacotizaciones ORDER BY fechahora DESC LIMIT 1
                                            )
                                        ELSE 0
                                    END
                                ELSE
                                    CASE
                                        WHEN facturas.NroMoneda = 1 THEN 
                                            IF(facturas.TipoMultitipo=2,(facturas.subtotal - Impuesto), facturas.Subtotal)
                                        WHEN facturas.NroMoneda = 2 THEN 
                                            IF(facturas.TipoMultitipo=2,-(facturas.subtotal - Impuesto), facturas.Subtotal) * (
                                                SELECT cotmoneda2 FROM monedacotizaciones ORDER BY fechahora DESC LIMIT 1
                                            )
                                        WHEN facturas.NroMoneda = 3 THEN 
                                            facturas.Subtotal * (
                                                SELECT cotmoneda3 FROM monedacotizaciones ORDER BY fechahora DESC LIMIT 1
                                            )
                                        ELSE 0
                                    END
                            END
                        ), 
                    2)
                FROM facturas
                WHERE DATE(facturas.FechaCreacion) = CURDATE() 
                  AND facturas.Estado IN (0, 1, 5)
                ) AS suma,

                (SELECT COUNT(*) 
                 FROM facturas
                 WHERE DATE(facturas.FechaCreacion) = CURDATE() 
                   AND facturas.Estado IN (0, 1, 5)
                ) AS cantidad,

                (SELECT facturas 
                 FROM objetivosmensuales 
                 WHERE idusuario = ?) AS objetivo_mensual,

                (SELECT facturas 
                 FROM objetivosdiarios 
                 WHERE idusuario = ?) AS objetivo_diario
            FROM facturas
            JOIN fiscal ON fiscal.RecID = facturas.IDFiscal
            WHERE DATE(facturas.FechaCreacion) = CURDATE() 
              AND facturas.Estado IN (0, 1, 5)
            ORDER BY facturas.Total DESC
            LIMIT 1;
        `,
        pedidos: `
            SELECT *, 
                (SELECT pedidos 
                 FROM objetivosdiarios 
                 WHERE idusuario = ?) AS objetivo_diario
            FROM resumen_pedidos
            WHERE DATE(resumen_pedidos.creado_en) = CURDATE()
        `,
        presupuestos: `
            SELECT *, 
                (SELECT presupuestos 
                 FROM objetivosdiarios 
                 WHERE idusuario = ?) AS objetivo_diario
            FROM resumen_presupuestos
            WHERE DATE(resumen_presupuestos.creado_en) = CURDATE()
        `,
        requerimientos: `
            SELECT SUM(requerimientos.SubTotal2) AS suma, COUNT(*) AS cantidad
            FROM requerimientos
            WHERE DATE(requerimientos.FechaCreacion) = CURDATE() AND requerimientos.Estado = 0
        `
    };

    // Ejecutamos todas las consultas en paralelo
    Promise.all([
        new Promise((resolve, reject) => {
            pool.query(queries.facturas, [idusuario, idusuario], (err, results) => {
                if (err) return reject(err);
                resolve(results[0] || {});
            });
        }),
        new Promise((resolve, reject) => {
            pool.query(queries.pedidos, [idusuario], (err, results) => {
                if (err) return reject(err);
                resolve(results[0] || {});
            });
        }),
        new Promise((resolve, reject) => {
            pool.query(queries.presupuestos, [idusuario], (err, results) => {
                if (err) return reject(err);
                resolve(results[0] || {});
            });
        }),
        new Promise((resolve, reject) => {
            pool.query(queries.requerimientos, (err, results) => {
                if (err) return reject(err);
                resolve(results[0] || {});
            });
        }),
    ])
    .then(([facturas, pedidos, presupuestos, requerimientos]) => {
        res.json({
            facturas,
            pedidos,
            presupuestos,
            requerimientos
        });
    })
    .catch(err => {
        console.error('Error al ejecutar las consultas:', err);
        res.status(500).json({ message: 'Error interno del servidor' });
    });
});


// app.get('/api/facturasmes', authenticateToken, (req, res) => {
//     const idusuario = req.user.userId;
//     const mes = parseInt(req.query.mes);
//     const modulo1 = 1;
//     const modulo2 = 2;

//     const facturasQuery = `
//         SELECT
//             (
//                 SELECT 
//                     SUM( IF(
//                         facturas.NroMoneda = 1, 
//                         IF(facturas.Tipo = 0, 
//                             IF(facturas.TipoMultitipo = 2, (facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto), (facturas.SubTotal - facturas.ImporteDescuento)), 
//                             IF(facturas.TipoMultitipo = 2, -(facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto), -(facturas.SubTotal - facturas.ImporteDescuento))
//                         ), 
//                         IF(facturas.Tipo = 0, 
//                             IF(facturas.TipoMultitipo = 2, (facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto) * monedacotizaciones.CotMoneda2, (facturas.SubTotal - facturas.ImporteDescuento) * monedacotizaciones.CotMoneda2), 
//                             IF(facturas.TipoMultitipo = 2, -((facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto) * monedacotizaciones.CotMoneda2), -((facturas.SubTotal - facturas.ImporteDescuento) * monedacotizaciones.CotMoneda2))
//                         )
//                     )) 
//                 FROM facturas
//                 LEFT JOIN monedacotizaciones ON monedacotizaciones.RecID = facturas.IDCotizacionMoneda
//                 WHERE facturas.Estado IN (0, 1, 5) AND MONTH(facturas.FechaCreacion) = ? AND YEAR(facturas.FechaCreacion) = YEAR(CURDATE())
//             ) AS suma_facturas,
//             (
//                 SELECT COUNT(*) 
//                 FROM facturas
//                 WHERE MONTH(facturas.FechaCreacion) = ?
//                   AND YEAR(facturas.FechaCreacion) = YEAR(CURDATE()) 
//                   AND facturas.Estado IN (0, 1, 5)
//             ) AS cantidad_facturas,
//             (
//                 SELECT valor 
//                 FROM objetivomensual 
//                 WHERE idusuario = ? AND modulo = ? AND mes = ?
//             ) AS objetivo_facturas
//     `;

//     const pedidosQuery = `
//         SELECT
//             SUM(suma) AS suma_pedidos,
//             SUM(cantidad) AS cantidad_pedidos,
//             (
//                 SELECT valor 
//                 FROM objetivomensual 
//                 WHERE idusuario = ? AND modulo = ? AND mes = ?
//             ) AS objetivo_pedidos
//         FROM resumen_pedidos 
//         WHERE MONTH(creado_en) = ? AND YEAR(creado_en) = YEAR(CURDATE())
//     `;

//     const presupuestosQuery = `
//         SELECT   
//             IF (presupuestos.NroMoneda=1, presupuestos.SubTotal2, presupuestos.SubTotal2 * monedacotizaciones.CotMoneda2) AS subtotal,
//             presupuestos.estado
//         FROM presupuestos
//         JOIN presupuestositems ON presupuestositems.IDPresupuesto = presupuestos.RecID
//         JOIN contactos ON contactos.IDContacto = presupuestos.IDRef
//         JOIN empresas ON empresas.IDEmpresa = contactos.IDEmpresa
//         JOIN fiscal ON fiscal.IDRef = empresas.IDEmpresa AND fiscal.Defecto = 1
//         JOIN usuarios ON usuarios.recid = presupuestos.IDUsuarioCreacion
//         LEFT JOIN monedacotizaciones ON monedacotizaciones.RecID = presupuestositems.IDCotizacionMoneda
//         WHERE MONTH(presupuestos.FechaCreacion) = ? 
//           AND YEAR(presupuestos.FechaCreacion) = YEAR(CURDATE())
//           AND presupuestos.Estado <> 2
//         GROUP BY presupuestos.RecID
//         ORDER BY presupuestos.FechaCreacion DESC
//     `;

//     const facturasParams = [mes, mes, idusuario, modulo1, mes];
//     const pedidosParams = [idusuario, modulo2, mes, mes];
//     const presupuestosParams = [mes];

//     // Ejecutar las tres consultas en paralelo
//     const facturasPromise = new Promise((resolve, reject) => {
//         pool.query(facturasQuery, facturasParams, (err, results) => {
//             if (err) return reject(err);
//             resolve(results[0]);
//         });
//     });

//     const pedidosPromise = new Promise((resolve, reject) => {
//         pool.query(pedidosQuery, pedidosParams, (err, results) => {
//             if (err) return reject(err);
//             resolve(results[0]);
//         });
//     });

//     const presupuestosPromise = new Promise((resolve, reject) => {
//         pool.query(presupuestosQuery, presupuestosParams, (err, results) => {
//             if (err) return reject(err);
//             resolve(results);
//         });
//     });

//     Promise.all([facturasPromise, pedidosPromise, presupuestosPromise])
//         .then(([facturas, pedidos, presupuestos]) => {
//             res.status(200).json({
//                 facturas,
//                 pedidos,
//                 presupuestos
//             });
//         })
//         .catch(err => {
//             console.error('Error al ejecutar una de las consultas:', err);
//             res.status(500).json({ message: 'Error interno del servidor' });
//         });
// });

// app.get('/api/facturasmes', authenticateToken, (req, res) => {
//     const idusuario = req.user.userId;
//     const mes = parseInt(req.query.mes); 
//     const modulo = 1

//     const query = `
//         SELECT
//         (
//             SELECT 
//                 SUM( IF(
//                     facturas.NroMoneda = 1, 
//                     IF(facturas.Tipo = 0, 
//                         IF(facturas.TipoMultitipo = 2, (facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto), (facturas.SubTotal - facturas.ImporteDescuento)), 
//                         IF(facturas.TipoMultitipo = 2, -(facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto), -(facturas.SubTotal - facturas.ImporteDescuento))
//                     ), 
//                     IF(facturas.Tipo = 0, 
//                         IF(facturas.TipoMultitipo = 2, (facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto) * monedacotizaciones.CotMoneda2, (facturas.SubTotal - facturas.ImporteDescuento) * monedacotizaciones.CotMoneda2), 
//                         IF(facturas.TipoMultitipo = 2, -((facturas.SubTotal - facturas.ImporteDescuento - facturas.Impuesto) * monedacotizaciones.CotMoneda2), -((facturas.SubTotal - facturas.ImporteDescuento) * monedacotizaciones.CotMoneda2))
//                     )
//                 )) AS suma      
//             FROM facturas
//             JOIN fiscal ON fiscal.RecID = facturas.IDFiscal
//             JOIN usuarios ON usuarios.RecID = facturas.IDUsuario
//             JOIN talonarios ON talonarios.RecID = facturas.IDTalonario
//             LEFT JOIN monedacotizaciones ON monedacotizaciones.RecID = facturas.IDCotizacionMoneda
//             WHERE facturas.Estado IN (0, 1, 5) AND MONTH(facturas.FechaCreacion) = ? AND YEAR(facturas.FechaCreacion) = YEAR(CURDATE())
//         ) AS suma,         

//         (
//             SELECT COUNT(*) 
//             FROM facturas
//             WHERE MONTH(facturas.FechaCreacion) = ?
//               AND YEAR(facturas.FechaCreacion) = YEAR(CURDATE()) 
//               AND facturas.Estado IN (0, 1, 5)
//         ) AS cantidad,

//         (
//             SELECT valor 
//             FROM objetivomensual 
//             WHERE idusuario = ? AND modulo = ? AND mes = ?
//         ) AS objetivo_mensual

//         FROM facturas
//         JOIN fiscal ON fiscal.RecID = facturas.IDFiscal
//         WHERE MONTH(facturas.FechaCreacion) = ?
//           AND YEAR(facturas.FechaCreacion) = YEAR(CURDATE())
//           AND facturas.Estado IN (0, 1, 5)
//         ORDER BY facturas.Total DESC
//         LIMIT 1;
//     `;

//     // Parámetros en el mismo orden que los signos de ?
//     const params = [mes, mes, idusuario, modulo, mes, mes];

//     pool.query(query, params, (err, results) => {
//         if (err) {
//             console.error('Error al ejecutar la consulta:', err);
//             return res.status(500).json({ message: 'Error interno del servidor' });
//         }
//         res.status(200).json(results[0]);
//     });
// });








// Array para almacenar los tokens (en una base de datos real, deberías usar una base de datos)
let expoPushTokens = [];

// Endpoint para guardar el token
app.post('/api/save-token', authenticateToken, async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).send({ error: 'Token es necesario' });
    }
    const userId = req.user.userId;

    const query = 'UPDATE usersapp SET pushToken = ? WHERE id = ?';

    pool.query(query, [token, userId], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).send({ error: 'Hubo un problema al guardar el token' });
        }

        if (results.affectedRows === 0) {
            return res.status(404).send({ error: 'Usuario no encontrado' });
        }

        res.status(200).send({ message: 'Token guardado con éxito' });
    });


});


// Función para obtener el pushtotal, pushtoken y realizar la verificación
async function checkAndSendNotificationForUser(user) {
    const pushtotal = user.pushtotal;
    const pushtoken = user.pushtoken;
    const today = new Date().toISOString().slice(0, 10); // Obtener la fecha actual "YYYY-MM-DD"

    // Obtener la suma desde la otra consulta
    const sumQuery = `SELECT ROUND(SUM(CASE
            WHEN facturas.tipo = 1 THEN 
                CASE
                    WHEN facturas.NroMoneda = 1 THEN -facturas.Total
                    WHEN facturas.NroMoneda = 2 THEN -facturas.Total * (
                        SELECT cotmoneda2 
                        FROM monedacotizaciones 
                        ORDER BY fechahora DESC 
                        LIMIT 1
                    )
                    WHEN facturas.NroMoneda = 3 THEN -facturas.Total * (
                        SELECT cotmoneda3 
                        FROM monedacotizaciones 
                        ORDER BY fechahora DESC 
                        LIMIT 1
                    )
                    ELSE 0
                END
            ELSE 
                CASE
                    WHEN facturas.NroMoneda = 1 THEN facturas.Total
                    WHEN facturas.NroMoneda = 2 THEN facturas.Total * (
                        SELECT cotmoneda2 
                        FROM monedacotizaciones 
                        ORDER BY fechahora DESC 
                        LIMIT 1
                    )
                    WHEN facturas.NroMoneda = 3 THEN facturas.Total * (
                        SELECT cotmoneda3 
                        FROM monedacotizaciones 
                        ORDER BY fechahora DESC 
                        LIMIT 1
                    )
                    ELSE 0
                END
        END), 2) AS suma
        FROM facturas
        WHERE date(facturas.FechaCreacion) = CURDATE() 
        AND (facturas.Estado = 0 OR facturas.Estado = 1 OR facturas.Estado = 5)`;

    pool.query(sumQuery, (err, sumResult) => {
        if (err) {
            console.error('Error al obtener la suma:', err);
            return;
        }

        const suma = sumResult[0].suma;

        // Verifica si el pushtotal es mayor o igual a la suma y si no se ha enviado notificación hoy
        if (suma >= pushtotal && user.notificacion_enviada === 0 && user.notificacion_dia !== today) {
            console.log(`El pushtotal de ${pushtoken} es mayor o igual a la suma. Enviando notificación...`);
            sendPushNotification(pushtoken, { title: '¡Buenas Noticias!', body: 'Superamos el valor de facturación 🥳' });

            // Actualizar el estado del usuario en la base de datos (marcar como notificado)
            const updateQuery = `UPDATE usersapp SET notificacion_enviada = 1, notificacion_dia = ? WHERE pushtoken = ?`;
            pool.query(updateQuery, [today, pushtoken], (err, result) => {
                if (err) {
                    console.error('Error al actualizar el estado del usuario:', err);
                    return;
                }
                console.log(`Notificación enviada y estado actualizado para el usuario con token ${pushtoken}`);
            });
        } else {
            console.log(`El pushtotal de ${pushtoken} no cumple la condición o la notificación ya fue enviada.`);
        }
    });
}

// Función para enviar la notificación
async function sendPushNotification(expoPushToken, message) {
    const body = {
        to: expoPushToken,
        sound: 'default',
        title: message.title || '¡Buenas Noticias!',
        body: message.body || 'Superamos el valor de facturación',
        data: message.data || {}, // Puedes agregar datos adicionales aquí
    };

    try {
        const response = await axios.post('https://exp.host/--/api/v2/push/send', body, {
            headers: { 'Content-Type': 'application/json' },
        });
        console.log('Notificación enviada:', response.data);
    } catch (error) {
        console.error('Error enviando notificación:', error);
    }
}

// Función principal para ejecutar el proceso de verificación e intervalo
async function checkAndNotifyForAllUsers() {
    // Obtener el pushtotal, pushtoken y notificacion_enviada desde la base de datos
    const query = 'SELECT pushtotal, pushtoken, notificacion_enviada, notificacion_dia FROM usersapp WHERE pushactivo = 0 AND pushtoken IS NOT NULL ';
    pool.query(query, (err, result) => {
        if (err) {
            console.error('Error al obtener el pushtotal y pushtoken:', err);
            return;
        }

        if (result.length === 0) {
            console.log('No hay usuarios con pushactivo=0');
            return;
        }

        // Iterar sobre los resultados para procesar cada usuario
        result.forEach(user => {
            // Llamar a la función de verificación y envío de notificación para cada usuario
            checkAndSendNotificationForUser(user);
        });
    });
}

// Restablecer el campo notificacion_enviada todos los días a la medianoche
cron.schedule('0 0 * * *', () => {
    console.log('Restableciendo la notificación enviada a todos los usuarios...');
    const resetQuery = 'UPDATE usersapp SET notificacion_enviada = 0, notificacion_dia = NULL WHERE pushactivo = 0';
    pool.query(resetQuery, (err, result) => {
        if (err) {
            console.error('Error al restablecer el estado de las notificaciones:', err);
        } else {
            console.log('Estado de notificación restablecido para todos los usuarios.');
        }
    });
});


// setInterval(() => {
//     checkAndNotifyForAllUsers();
// }, 60000); // Intervalo de 10 minutos



// Configuración del servidor
const PORT = 7000;
app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));


