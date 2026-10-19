const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => typeof value === 'string' && uuidPattern.test(value);

// A non-empty string once trimmed, no longer than `max` characters.
export const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

// Absent, null or a string no longer than `max` characters.
export const isOptionalText = (value: unknown, max: number) =>
  value === undefined || value === null || (typeof value === 'string' && value.length <= max);
