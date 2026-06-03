import React from 'react';
import { Table } from 'antd';
import styled from 'styled-components';

// Styled component to handle the specific UI requirements
const StyledTable = styled(Table)`
  .ant-table-thead > tr > th {
    text-align: center;
    background: #f0f2f5;
  }
  
  .weekend-header {
    background-color: #ff4d4f !important;
    color: white !important;
  }

  .in-time {
    color: #1890ff; /* Blue */
    font-weight: 500;
  }

  .out-time {
    color: #f5222d; /* Red/Orange */
    font-weight: 500;
  }

  .official-business {
    background-color: #fffbe6; /* Light Yellow */
    display: block;
    width: 100%;
    height: 100%;
    text-align: center;
  }
`;

const AttendanceDashboard = () => {
  // Sample Data Structure
  const dataSource = [
    {
      key: '1',
      name: 'ดวงพร ยอดมาลัย',
      department: 'กลุ่มงานบริหารทั่วไป',
      attendance: {
        '01': { in: '08:37:51', out: '18:40:47' },
        '02': { in: '08:28:16', out: '20:28:56' },
        '03': { in: '08:14:25', out: '16:42:20' },
        '07': { in: '08:30:05', out: null },
      },
    },
    {
      key: '7',
      name: 'จีรภัทร พึ่งเกษม',
      department: 'กลุ่มงานการพยาบาล',
      attendance: {
        '01': { status: 'OFFICIAL', label: 'ไปราชการ' },
        '02': { in: '08:30:54', out: '16:52:52' },
        '03': { in: '08:38:49', out: '17:07:17' },
        '07': { in: '08:32:27', out: null },
      },
    },
  ];

  // Helper to check if a day is weekend (Example logic for May 2024)
  const isWeekend = (day) => ['04', '05'].includes(day);

  // Dynamic Column Generation
  const dateColumns = ['01', '02', '03', '04', '05', '06', '07'].map((day) => ({
    title: `${day} (พ.ค.)`,
    className: isWeekend(day) ? 'weekend-header' : '',
    children: [
      {
        title: 'เข้า',
        dataIndex: ['attendance', day],
        key: `${day}-in`,
        width: 100,
        render: (record) => {
          if (!record) return '-';
          if (record.status === 'OFFICIAL') return <span className="official-business">{record.label}</span>;
          return <span className="in-time">{record.in || '-'}</span>;
        },
      },
      {
        title: 'ออก',
        dataIndex: ['attendance', day],
        key: `${day}-out`,
        width: 100,
        render: (record) => {
          if (!record || record.status === 'OFFICIAL') return '-';
          return <span className="out-time">{record.out || '-'}</span>;
        },
      },
    ],
  }));

  const columns = [
    {
      title: 'ชื่อ-นามสกุล',
      dataIndex: 'name',
      key: 'name',
      fixed: 'left',
      width: 180,
    },
    {
      title: 'แผนก',
      dataIndex: 'department',
      key: 'department',
      fixed: 'left',
      width: 200,
    },
    ...dateColumns,
  ];

  return (
    <div style={{ padding: '20px' }}>
      <StyledTable
        dataSource={dataSource}
        columns={columns}
        bordered
        pagination={false}
        scroll={{ x: 1500 }}
        size="small"
      />
    </div>
  );
};

export default AttendanceDashboard;
