export const calculateCommission = (
  servicePrice: number,
  workerPercentage: number = 40
): { worker: number; owner: number } => {
  const worker = parseFloat(
    (servicePrice * (workerPercentage / 100)).toFixed(2)
  );
  const owner = parseFloat((servicePrice * ((100 - workerPercentage) / 100)).toFixed(2));

  return { worker, owner };
};

export const calculateTotalAmount = (
  items: Array<{ subtotal: number }>
): number => {
  return parseFloat(
    items.reduce((sum, item) => sum + parseFloat(item.subtotal.toString()), 0).toFixed(2)
  );
};

export const calculateRemainingAmount = (
  total: number,
  amountPaid: number
): number => {
  return parseFloat(Math.max(0, total - amountPaid).toFixed(2));
};

export const calculateDiscountAmount = (
  total: number,
  discountPercent: number
): number => {
  return parseFloat((total * (discountPercent / 100)).toFixed(2));
};

export const calculateAmountAfterDiscount = (
  total: number,
  discountPercent: number
): number => {
  const discount = calculateDiscountAmount(total, discountPercent);
  return parseFloat((total - discount).toFixed(2));
};

export const formatCurrency = (amount: number): string => {
  return `${Math.round(amount).toLocaleString('fr-FR')} RWF`;
};

export const formatDate = (date: Date): string => {
  return new Date(date).toLocaleDateString('fr-FR');
};

export const formatDateTime = (date: Date): string => {
  return new Date(date).toLocaleString('fr-FR');
};

export const formatPhoneNumber = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5');
};

export const generateId = (): string => {
  return Math.random().toString(36).substring(2, 11);
};

export const isWithinDateRange = (
  date: Date,
  startDate: Date,
  endDate: Date
): boolean => {
  return date >= startDate && date <= endDate;
};

export const getMonthRange = (date: Date): { start: Date; end: Date } => {
  const year = date.getFullYear();
  const month = date.getMonth();
  return {
    start: new Date(year, month, 1),
    end: new Date(year, month + 1, 0),
  };
};

export const getWeekRange = (date: Date): { start: Date; end: Date } => {
  const curr = new Date(date);
  const first = curr.getDate() - curr.getDay();
  const last = first + 6;

  return {
    start: new Date(curr.setDate(first)),
    end: new Date(curr.setDate(last)),
  };
};

export const getYearRange = (date: Date): { start: Date; end: Date } => {
  const year = date.getFullYear();
  return {
    start: new Date(year, 0, 1),
    end: new Date(year, 11, 31),
  };
};

export const roundToTwoDecimals = (num: number): number => {
  return parseFloat(num.toFixed(2));
};

export const calculatePercentage = (part: number, total: number): number => {
  if (total === 0) return 0;
  return parseFloat(((part / total) * 100).toFixed(2));
};

export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};