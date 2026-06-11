/** Manual payment options (Stripe disabled). */
const EASYPAISA_NUMBER = '03483510584';

const PAYMENT_METHODS = {
  cod: {
    id: 'cod',
    label: 'Cash on delivery',
    paymentMethodLabel: 'Cash on delivery'
  },
  bank_transfer: {
    id: 'bank_transfer',
    label: 'Bank transfer (Easypaisa)',
    paymentMethodLabel: 'Bank transfer (Easypaisa)',
    easypaisa: EASYPAISA_NUMBER
  },
  wallet: {
    id: 'wallet',
    label: 'Bazaar Wallet',
    paymentMethodLabel: 'Bazaar Wallet'
  }
};

function isAllowedManualPaymentMethod(method) {
  return method === 'cod' || method === 'bank_transfer' || method === 'wallet';
}

module.exports = {
  EASYPAISA_NUMBER,
  PAYMENT_METHODS,
  isAllowedManualPaymentMethod
};
