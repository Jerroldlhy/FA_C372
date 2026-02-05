const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '.env') }); // fallback when running from project root

//Database connection details
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool;
