const IGConnections = require('../models/IG-Connections');
const WebConnection = require('../models/WebConnection'); // <--- اضافه شد
const Subscription = require('../models/Subscription');
const mongoose = require('mongoose');

const subscriptionManager = {
  /**
   * بررسی دسترسی و محدودیت‌ها (مشترک برای وب و اینستاگرام)
   */
  checkLimit: async (accountId) => {
    // console.log(`🛡️ GATEKEEPER: Checking limit for: ${accountId}`);

    try {
      let userId = null;

      // 1. تلاش برای پیدا کردن در اینستاگرام
      const igConnection = await IGConnections.findOne({
        ig_userId: accountId,
      });
      if (igConnection) {
        userId = igConnection.user_id;
      } else {
        // 2. تلاش برای پیدا کردن در وب (اگر ID معتبر مونگو باشد)
        if (mongoose.Types.ObjectId.isValid(accountId)) {
          const webConnection = await WebConnection.findById(accountId);
          if (webConnection) {
            userId = webConnection.user_id;
          }
        }
      }

      if (!userId) {
        console.error(`❌ GATEKEEPER: Account ${accountId} not found in DB.`);
        return { allowed: false, reason: 'Account not found' };
      }

      // 3. پیدا کردن اشتراک فعال کاربر
      const sub = await Subscription.findOne({
        user_id: userId,
        status: 'active',
      });

      if (!sub) {
        return { allowed: false, reason: 'No active subscription' };
      }

      // 4. چک تاریخ انقضا
      if (new Date() > sub.endDate) {
        sub.status = 'expired';
        await sub.save();
        return { allowed: false, reason: 'Subscription expired' };
      }

      // 5. چک سقف مصرف پیام
      const limit = sub.currentLimits.messageCount;
      const used = sub.usage.messagesUsed;

      if (used >= limit) {
        return { allowed: false, reason: 'Message limit reached' };
      }

      return { allowed: true, subscription: sub };
    } catch (error) {
      console.error('Gatekeeper Error:', error);
      return { allowed: false, reason: 'Server Error' };
    }
  },

  // بررسی دسترسی به ویژگی خاص (مثل AI)
  checkFeatureAccess: (subscription, featureName) => {
    if (
      subscription &&
      subscription.currentFeatures &&
      subscription.currentFeatures[featureName] === true
    ) {
      return true;
    }
    return false;
  },

  // بررسی اعتبار توکن AI
  checkAiLimit: async (subscription) => {
    const limit = subscription.currentLimits.aiTokenLimit || 0;
    const used = subscription.usage.aiTokensUsed || 0;

    if (used >= limit) {
      console.log(`⛔ AI Token Limit Reached (${used}/${limit})`);
      return false;
    }
    return true;
  },

  // افزایش مصرف توکن
  incrementAiUsage: async (subscriptionId, tokensUsed) => {
    try {
      await Subscription.findByIdAndUpdate(subscriptionId, {
        $inc: {
          'usage.messagesUsed': 1,
          'usage.aiTokensUsed': tokensUsed,
        },
      });
    } catch (error) {
      console.error('Usage Increment Error:', error);
    }
  },

  // افزایش مصرف پیام معمولی
  incrementUsage: async (subscriptionId) => {
    try {
      await Subscription.findByIdAndUpdate(subscriptionId, {
        $inc: { 'usage.messagesUsed': 1 },
      });
    } catch (error) {
      console.error('Usage Increment Error:', error);
    }
  },
};

module.exports = subscriptionManager;
