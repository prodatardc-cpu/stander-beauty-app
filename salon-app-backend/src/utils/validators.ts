export const validateEmail = (email: string): boolean => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};

export const validatePhone = (phone: string): boolean => {
  const regex = /^[0-9]{10,}$/;
  return regex.test(phone.replace(/\D/g, ''));
};

export const validatePrice = (price: unknown): boolean => {
  const num = Number(price);
  return !isNaN(num) && num > 0;
};

export const validatePercentage = (percentage: unknown): boolean => {
  const num = Number(percentage);
  return !isNaN(num) && num >= 0 && num <= 100;
};

export const validateStockQuantity = (quantity: unknown): boolean => {
  const num = Number(quantity);
  return Number.isInteger(num) && num >= 0;
};

export const validateCommissionPercentage = (percentage: unknown): boolean => {
  const num = Number(percentage);
  return !isNaN(num) && num > 0 && num < 100;
};

export const validatePassword = (password: string): boolean => {
  return password.length >= 6;
};

export const validatePaymentMethod = (method: string): boolean => {
  const validMethods = ['cash', 'momo', 'card', 'transfer', 'other'];
  return validMethods.includes(method);
};

export const validateAppointmentStatus = (status: string): boolean => {
  const validStatuses = [
    'scheduled',
    'confirmed',
    'completed',
    'cancelled',
    'no_show',
  ];
  return validStatuses.includes(status);
};

export const validateRole = (role: string): boolean => {
  const validRoles = ['admin', 'staff', 'cashier'];
  return validRoles.includes(role);
};