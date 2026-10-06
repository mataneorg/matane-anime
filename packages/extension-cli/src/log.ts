const color = process.stdout.isTTY && !process.env['NO_COLOR'];
const paint = (code: number) => (text: string) => (color ? `\u001b[${code}m${text}\u001b[0m` : text);

export const green = paint(32);
export const red = paint(31);
export const yellow = paint(33);
export const dim = paint(2);
export const bold = paint(1);

export const ok = (message: string, detail = ''): void =>
  console.log(`${green('✓')} ${message}${detail ? ` ${dim(detail)}` : ''}`);
export const fail = (message: string): void => console.log(`${red('✗')} ${message}`);
export const warn = (message: string): void => console.warn(`${yellow('!')} ${message}`);
