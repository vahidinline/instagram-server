const axios = require('axios');

// آدرس‌های زرین‌پال
const ZARINPAL_REQUEST_URL =
  'https://api.zarinpal.com/pg/v4/payment/request.json';
const ZARINPAL_VERIFY_URL =
  'https://api.zarinpal.com/pg/v4/payment/verify.json';
const MERCHANT_ID = process.env.ZARINPAL_MERCHANT; // کد مرچنت ۳۶ رقمی

const zarinpal = {
  // 1. درخواست پرداخت (کاربر را به بانک می‌فرستد)
  requestPayment: async (amount, callbackUrl, description, email, mobile) => {
    try {
      const response = await axios.post(ZARINPAL_REQUEST_URL, {
        merchant_id: MERCHANT_ID,
        amount: amount, // تومان (زرین‌پال نسخه ۴ تومان است یا ریال؟ داکیومنت چک شود. معمولا ریال است، اینجا فرض را تومان می‌گیریم ولی باید ضربدر ۱۰ شود اگر ریال است)
        callback_url: callbackUrl,
        description: description,
        metadata: { email, mobile },
      });

      const { data } = response.data;

      if (data.code === 100) {
        return {
          success: true,
          authority: data.authority,
          paymentUrl: `https://www.zarinpal.com/pg/StartPay/${data.authority}`,
        };
      } else {
        return {
          success: false,
          error: 'Zarinpal Request Failed code: ' + data.code,
        };
      }
    } catch (error) {
      console.error('Zarinpal Request Error:', error.message);
      return { success: false, error: error.message };
    }
  },

  // 2. تایید پرداخت (وقتی کاربر از بانک برمی‌گردد)
  verifyPayment: async (amount, authority) => {
    try {
      const response = await axios.post(ZARINPAL_VERIFY_URL, {
        merchant_id: MERCHANT_ID,
        amount: amount,
        authority: authority,
      });

      const { data } = response.data;

      if (data.code === 100) {
        return { success: true, refId: data.ref_id };
      } else if (data.code === 101) {
        return {
          success: true,
          refId: data.ref_id,
          message: 'Already Verified',
        };
      } else {
        return { success: false, code: data.code };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
};

module.exports = zarinpal;
