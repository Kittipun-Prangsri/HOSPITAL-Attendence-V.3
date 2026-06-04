const { getData } = require('../../src/controllers/apiController');

async function testGetData() {
  const req = {
    query: { date: '2026-06-04' },
    session: {
      user: { id: 174, role: 'super' } // matches "กิตติพันธ์ ปรางศรี"
    }
  };
  
  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      console.log('--- API /api/data RESPONSE ---');
      console.log('Employees Count:', data.employees ? data.employees.length : 0);
      console.log('Timeline Scans Count:', data.timelineData ? data.timelineData.length : 0);
      console.log('Scan Queue Count:', data.scanQueue ? data.scanQueue.length : 0);
      console.log('Service Work (Leave) Count:', data.serviceWorkData ? data.serviceWorkData.length : 0);
      if (data.employees && data.employees.length > 0) {
        console.log('Sample Employee:', JSON.stringify(data.employees[0], null, 2));
      }
      process.exit(0);
    }
  };
  
  try {
    await getData(req, res);
  } catch (err) {
    console.error('Error running test:', err);
    process.exit(1);
  }
}

testGetData();
