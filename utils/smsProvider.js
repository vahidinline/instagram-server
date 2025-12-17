const axios = require('axios');

const sendOTP = async (phone, code) => {
  try {
    // آدرس دقیق وب‌سرویس خدماتی (پترن) ملی پیامک
    const url = 'https://rest.payamak-panel.com/api/SendSMS/BaseServiceNumber';

    const data = {
      username: process.env.MELIPAYAMAK_USERNAME,
      password: process.env.MELIPAYAMAK_PASSWORD,
      text: code, // این مقدار جایگزین {0} در متن پترن می‌شود
      to: phone,
      bodyId: parseInt(process.env.MELIPAYAMAK_BODY_ID), // شناسه پترن (حتما عدد باشد)
    };

    console.log(`📤 Sending OTP to ${phone} via Pattern ID: ${data.bodyId}`);

    const response = await axios.post(url, data);

    // لاگ دقیق ریسپانس برای دیباگ
    console.log('📨 SMS Response:', response.data);

    // بررسی موفقیت طبق مستندات ملی پیامک
    // اگر موفق باشد، Value یک رشته طولانی (شناسه پیام) است
    // اگر خطا باشد، معمولا Value خالی است یا RetStatus عدد غیر ۱ است
    if (
      (response.data &&
        response.data.Value &&
        response.data.Value.length > 5) ||
      response.data.RetStatus === 1
    ) {
      return true;
    } else {
      console.error('❌ SMS Provider Error:', response.data);
      // در محیط پروداکشن اینجا باید فالس برگردانید، اما برای تست لاگ می‌کنیم
      return false;
    }
  } catch (error) {
    console.error('❌ SMS Network Error:', error.message);

    // *** فقط برای محیط دولوپمنت ***
    // کد را در کنسول چاپ می‌کنیم تا اگر پنل پیامک شارژ نداشت، کار لنگ نماند
    console.log(`🔒 [DEV MODE] OTP for ${phone}: ${code}`);

    return false;
  }
};

module.exports = { sendOTP };
