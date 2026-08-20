const { calculateLateThreshold } = require('./time');

describe('calculateLateThreshold', () => {
  test('adds the grace period to the shift start time', () => {
    expect(calculateLateThreshold('08:00', 31)).toBe('08:31:00');
  });

  test('rolls minutes over into the next hour', () => {
    expect(calculateLateThreshold('08:45', 30)).toBe('09:15:00');
  });

  test('rolls hours over past midnight', () => {
    expect(calculateLateThreshold('23:50', 20)).toBe('00:10:00');
  });

  test('handles a zero-minute grace period', () => {
    expect(calculateLateThreshold('08:00', 0)).toBe('08:00:00');
  });

  test('pads single-digit hours and minutes', () => {
    expect(calculateLateThreshold('01:05', 2)).toBe('01:07:00');
  });
});
