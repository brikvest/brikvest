/** A calendar day, never an instant. Restrict to PostgreSQL's four-digit AD years. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

const months = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/** Month-only listing information, without an invented day or time zone. */
export function isCalendarMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value) && isCalendarDate(`${value}-01`);
}

export function formatCalendarDate(value: string): string {
  if (!isCalendarDate(value)) throw new Error("Invalid calendar date");
  const [year, month, day] = value.split("-").map(Number);
  return `${day} ${months[month - 1]} ${String(year).padStart(4, "0")}`;
}

/** Month/year presentation of a calendar day, without time-zone conversion. */
export function formatCalendarMonthYear(value: string): string {
  if (!isCalendarDate(value)) throw new Error("Invalid calendar date");
  const [year, month] = value.split("-");
  return `${months[Number(month) - 1]} ${year}`;
}
