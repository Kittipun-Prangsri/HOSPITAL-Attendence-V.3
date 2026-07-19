const palette = {
  primary: '#0f766e',
  primaryDark: '#115e59',
  info: '#0369a1',
  success: '#166534',
  warning: '#92400e',
  danger: '#b91c1c',
  text: '#132238',
  muted: '#475569',
  white: '#ffffff',
  primarySoft: '#ccfbf1',
  infoSoft: '#e0f2fe',
  successSoft: '#dcfce7',
  warningSoft: '#fef3c7',
  dangerSoft: '#fee2e2'
};

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const pairs = [
  ['white', 'primary'], ['white', 'primaryDark'], ['white', 'info'], ['white', 'success'], ['white', 'warning'], ['white', 'danger'],
  ['text', 'white'], ['muted', 'white'], ['primaryDark', 'primarySoft'], ['info', 'infoSoft'], ['success', 'successSoft'], ['warning', 'warningSoft'], ['danger', 'dangerSoft']
];

let failed = false;
for (const [foreground, background] of pairs) {
  const ratio = contrast(palette[foreground], palette[background]);
  const pass = ratio >= 4.5;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
  failed ||= !pass;
}
process.exitCode = failed ? 1 : 0;
