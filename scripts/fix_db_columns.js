const { hosofficePool } = require('../src/config/db');

async function migrate() {
  try {
    console.log('--- Starting Database Migration: Adding Missing Columns ---');
    
    // Check current columns
    const [columns] = await hosofficePool.query("SHOW COLUMNS FROM hr_person");
    const columnNames = columns.map(c => c.Field);
    
    const missing = [];
    if (!columnNames.includes('WORK_SHIFT')) missing.push('ADD COLUMN WORK_SHIFT VARCHAR(50) NULL');
    if (!columnNames.includes('TIME_IN')) missing.push('ADD COLUMN TIME_IN VARCHAR(10) NULL');
    if (!columnNames.includes('TIME_OUT')) missing.push('ADD COLUMN TIME_OUT VARCHAR(10) NULL');

    if (missing.length > 0) {
      const sql = `ALTER TABLE hr_person ${missing.join(', ')}`;
      console.log('Executing SQL:', sql);
      await hosofficePool.query(sql);
      console.log('✅ Success: Columns added successfully.');
    } else {
      console.log('ℹ️ Notice: All columns already exist. No action needed.');
    }
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    process.exit(0);
  }
}

migrate();
