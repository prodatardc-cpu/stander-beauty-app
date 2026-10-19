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
