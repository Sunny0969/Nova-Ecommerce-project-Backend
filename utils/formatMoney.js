/**
 * Format amounts for emails / API messages as PKR.
 */
function formatStoreMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n);
  return new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(x);
}

module.exports = { formatStoreMoney };
