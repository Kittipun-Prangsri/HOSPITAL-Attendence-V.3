const http = require('http');

async function testReport() {
  const url = 'http://localhost:3001/api/report/monthly?month=6&year=2026';
  
  // We need to bypass auth by using a session cookie or simulating a request.
  // Wait, let's write a test that calls the controller method directly using mock req/res!
  // That is much cleaner and doesn't require session auth cookies!
  try {
    const { getMonthlyReport } = require('../../src/controllers/apiController');
    
    // Mock req and res
    const req = {
      query: { month: '6', year: '2026' },
      session: {
        user: { id: 1, role: 'admin' } // simulates logged-in admin user
      }
    };
    
    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        console.log('--- API RESPONSE SUCCESS ---');
        console.log('Success:', data.success);
        console.log('Report Rows Count:', data.report ? data.report.length : 0);
        if (data.report && data.report.length > 0) {
          console.log('Sample Row 1:', JSON.stringify(data.report[0], null, 2));
          
          // Print some statistics
          const totalPresent = data.report.reduce((sum, r) => sum + r.daysPresent, 0);
          const totalLate = data.report.reduce((sum, r) => sum + r.lateCount, 0);
          const totalAbsent = data.report.reduce((sum, r) => sum + r.absentCount, 0);
          const totalLeaves = data.report.reduce((sum, r) => sum + r.leaveCount, 0);
          console.log(`\n--- Aggregated Stats ---`);
          console.log(`Total Present Days: ${totalPresent}`);
          console.log(`Total Late Times: ${totalLate}`);
          console.log(`Total Absent Days: ${totalAbsent}`);
          console.log(`Total Leave Days: ${totalLeaves}`);
        } else {
          console.log('No report data returned.');
        }
        process.exit(0);
      }
    };
    
    console.log('Starting getMonthlyReport Controller Test...');
    await getMonthlyReport(req, res);
  } catch (err) {
    console.error('Test Execution Error:', err);
    process.exit(1);
  }
}

testReport();
