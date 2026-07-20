# Staff Schedule Modal

Reusable monthly staff-schedule dialog extracted from the KHH dashboard.

## Files to copy

- `views/components/staff-schedule-modal.ejs`
- `public/css/staff-schedule-modal.css`
- `public/js/staff-schedule-modal.js`
- `docs/samples/staff-schedule-modal-demo.html` (optional standalone demo)

The destination page also needs Bootstrap Icons and the shared status classes from the destination design system.

## EJS integration

Add the stylesheet in the page `<head>`:

```ejs
<link rel="stylesheet" href="/css/staff-schedule-modal.css">
```

Add the modal near the end of `<body>`, followed by its script:

```ejs
<%- include("components/staff-schedule-modal") %>
<script src="/js/staff-schedule-modal.js"></script>
```

Open the dialog with a complete employee object:

```js
StaffScheduleModal.open({
  id: 'KHH0001',
  name: 'ชื่อ นามสกุล',
  dept: 'กลุ่มงานการพยาบาล',
  role: 'พยาบาลวิชาชีพ',
  shift: 'เช้า',
  status: 'in',
  in: '08:30',
  out: '16:30',
  hours: '8'
});
```

The original dashboard call remains supported:

```js
viewStaff('KHH0001');
```

When called with an ID, the module searches the array returned by `getEmployees`.

## Configuration

Configure the module after loading its script and before opening it:

```js
StaffScheduleModal.configure({
  apiBase: '/api/schedule/staff',
  timeZone: 'Asia/Bangkok',
  getEmployees: () => window.myEmployees,
  getColors: () => ['#0f766e', '#0369a1', '#92400e'],
  getShiftDefinitions: () => ({
    morning: { label: 'เช้า' },
    afternoon: { label: 'บ่าย' },
    night: { label: 'ดึก' }
  }),
  getSettings: () => ({
    shifts: [{ name: 'เช้า' }, { name: 'บ่าย' }, { name: 'ดึก' }]
  }),
  getServiceWork: () => []
});
```

Only `apiBase` and `getEmployees` normally need changing on another website.

### Use an existing API shape

If the destination website already has a different API, provide a loader instead of creating the REST route shown below:

```js
StaffScheduleModal.configure({
  loadSchedule: async ({ staffId, year, month, yearMonth }) => {
    const response = await fetch(`/my-existing-api/shifts?employee=${encodeURIComponent(staffId)}&month=${yearMonth}`);
    const existingData = await response.json();

    return {
      shifts: existingData.workDays.map(item => ({ day: item.day, shift: item.shiftName })),
      times: existingData.clockTimes.map(item => ({
        day: item.day,
        time_in: item.firstScan,
        time_out: item.lastScan
      })),
      leaves: existingData.leaveDays.map(item => ({ day: item.day, reason: item.reason }))
    };
  }
});
```

`loadSchedule` may also return local or mock data and does not have to call a server.

## API contract

The component requests:

```text
GET {apiBase}/{employeeId}/{YYYY-MM}
```

Expected JSON:

```json
{
  "success": true,
  "staffId": "KHH0001",
  "yearMonth": "2026-07",
  "shifts": [
    { "day": 1, "shift": "เช้า" }
  ],
  "times": [
    { "day": 1, "time_in": "08:30:00", "time_out": "16:30:00" }
  ],
  "leaves": [
    { "day": 7, "reason": "ลาป่วย" }
  ]
}
```

Missing arrays may be returned as empty arrays. If the request fails, the component shows any same-day information supplied in the employee object.

## Standalone demo

Open `docs/samples/staff-schedule-modal-demo.html` in a browser. The demo uses mock data through `loadSchedule`, so it does not require a database or authenticated API. Bootstrap Icons are loaded from a CDN and require an internet connection; the modal remains functional without the icons.

## Security requirements

- Keep authentication and employee-level authorization on the API endpoint.
- Do not copy `.env`, database credentials, session secrets, or production employee data.
- Return only fields needed by the calendar.
- Serve the destination site over HTTPS in production.
