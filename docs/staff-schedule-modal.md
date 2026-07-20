# Staff Schedule Modal

Reusable monthly staff-schedule dialog extracted from the KHH dashboard.

## Files to copy

- `views/components/staff-schedule-modal.ejs`
- `public/css/staff-schedule-modal.css`
- `public/js/staff-schedule-modal.js`

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

## Security requirements

- Keep authentication and employee-level authorization on the API endpoint.
- Do not copy `.env`, database credentials, session secrets, or production employee data.
- Return only fields needed by the calendar.
- Serve the destination site over HTTPS in production.
