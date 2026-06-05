require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { dbConfig } = require('../src/config/db');

async function initMockHosoffice() {
  try {
    const connection = await mysql.createConnection(dbConfig);
    console.log('Connected to MySQL server.');

    const dbName = process.env.DB_NAME_HOSOFFICE || 'hosoffice';
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${dbName} COLLATE utf8mb4_unicode_ci`);
    console.log(`Database ${dbName} created or already exists.`);

    await connection.query(`USE ${dbName}`);

    // Drop tables if they exist for a clean mock setup
    await connection.query('DROP TABLE IF EXISTS hr_person');
    await connection.query('DROP TABLE IF EXISTS hr_department');
    await connection.query('DROP TABLE IF EXISTS hr_status');

    // Create hr_department table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS hr_department (
        HR_DEPARTMENT_ID INT AUTO_INCREMENT PRIMARY KEY,
        HR_DEPARTMENT_NAME VARCHAR(255)
      )
    `);

    // Create hr_status table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS hr_status (
        HR_STATUS_ID INT AUTO_INCREMENT PRIMARY KEY,
        HR_STATUS_NAME VARCHAR(100)
      )
    `);

    // Create hr_person table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS hr_person (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        HR_CID VARCHAR(20) UNIQUE,
        HR_FNAME VARCHAR(100),
        HR_LNAME VARCHAR(100),
        NICKNAME VARCHAR(100),
        USER_TYPE VARCHAR(20),
        HR_PASSWORD_HASH VARCHAR(255),
        FINGLE_ID VARCHAR(50),
        HR_PHONE VARCHAR(20),
        HR_EMAIL VARCHAR(100),
        HR_DEPARTMENT_ID INT,
        HR_STATUS_ID INT,
        HR_STARTWORK_DATE DATE,
        LINE_YOUR_USER_ID VARCHAR(100),
        TELEGRAM_CHAT_ID VARCHAR(100),
        WORK_SHIFT VARCHAR(50),
        TIME_IN TIME,
        TIME_OUT TIME
      )
    `);

    // Insert mock admin and staff
    await connection.query(`
      INSERT IGNORE INTO hr_person (HR_CID, HR_FNAME, HR_LNAME, USER_TYPE, FINGLE_ID) 
      VALUES 
      ('admin', 'Admin', 'User', 'super', '1001'),
      ('staff', 'Staff', 'User', 'user', '1002')
    `);

    // Seed data from db.json if exists
    const dbPath = path.join(__dirname, '..', 'data', 'db.json');
    if (fs.existsSync(dbPath)) {
      const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      console.log('Seeding employees from db.json into hosoffice...');

      for (const emp of data.employees) {
        // Split name into FNAME and LNAME
        const nameParts = emp.name.split(' ');
        const fname = nameParts[0];
        const lname = nameParts.slice(1).join(' ');

        // Find or create department
        let deptId = null;
        if (emp.dept) {
          const [deptRows] = await connection.query('SELECT HR_DEPARTMENT_ID FROM hr_department WHERE HR_DEPARTMENT_NAME = ?', [emp.dept]);
          if (deptRows.length > 0) {
            deptId = deptRows[0].HR_DEPARTMENT_ID;
          } else {
            const [deptResult] = await connection.query('INSERT INTO hr_department (HR_DEPARTMENT_NAME) VALUES (?)', [emp.dept]);
            deptId = deptResult.insertId;
          }
        }

        // Insert into hr_person
        await connection.query(`
          INSERT IGNORE INTO hr_person 
          (HR_CID, HR_FNAME, HR_LNAME, FINGLE_ID, HR_DEPARTMENT_ID, WORK_SHIFT, TIME_IN, TIME_OUT)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          emp.id, 
          fname, 
          lname, 
          emp.id.replace('N', ''), // Mock FINGLE_ID
          deptId,
          emp.shift,
          emp.in === '—' ? null : (emp.in.length === 5 ? emp.in + ':00' : emp.in),
          emp.out === '—' ? null : (emp.out.length === 5 ? emp.out + ':00' : emp.out)
        ]);
      }
      console.log('Seeding completed.');
    }

    console.log('Mock HOSoffice tables created and seeded.');
    await connection.end();
  } catch (error) {
    console.error('Error initializing mock HOSoffice:', error);
  }
}

initMockHosoffice();
