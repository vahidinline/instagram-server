const IGConnections = require('../models/IG-Connections');
const WebConnection = require('../models/WebConnection');
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan'); // <--- نیاز است
const mongoose = require('mongoose');

const subscriptionManager = {
  checkLimit: async (accountId, platform = 'instagram') => {
    try {
      let userId = null;

      // 1. پیدا کردن صاحب اکانت
      if (platform === 'web') {
        if (mongoose.Types.ObjectId.isValid(accountId)) {
          const webConnection = await WebConnection.findById(accountId);
          if (webConnection) userId = webConnection.user_id;
        }
      } else {
        const igConnection = await IGConnections.findOne({
          ig_userId: accountId,
        });
        if (igConnection) userId = igConnection.user_id;
      }

      if (!userId) {
        console.error(`❌ Account not found: ${accountId}`);
        return { allowed: false, reason: 'Account not found' };
      }

      // 2. پیدا کردن اشتراک
      let sub = await Subscription.findOne({
        user_id: userId,
        status: 'active',
      });

      // *** فیکس خودکار: اگر اشتراک نداشت، همان لحظه بساز ***
      if (!sub) {
        console.log(
          `⚠️ User ${userId} has no subscription. Creating FREE plan automatically...`
        );

        // پیدا کردن پلن رایگان یا ساختن آن
        let freePlan = await Plan.findOne({ slug: 'free' });
        if (!freePlan) {
          freePlan = await Plan.create({
            name: 'Free Plan',
            slug: 'free',
            price: 0,
            limits: { messageCount: 100, aiTokenLimit: 5000 },
            features: { aiAccess: true },
          });
        }

        // ایجاد اشتراک برای کاربر
        sub = await Subscription.create({
          user_id: userId,
          plan_id: freePlan._id,
          status: 'active',
          startDate: new Date(),
          endDate: new Date(
            new Date().setFullYear(new Date().getFullYear() + 1)
          ), // 1 سال اعتبار
          currentLimits: freePlan.limits,
          currentFeatures: freePlan.features,
          usage: { messagesUsed: 0, aiTokensUsed: 0 },
        });
      }

      // 3. چک کردن تاریخ انقضا
      if (new Date() > sub.endDate) {
        return { allowed: false, reason: 'Subscription expired' };
      }

      // 4. چک کردن سقف مصرف
      const limit = sub.currentLimits.messageCount;
      const used = sub.usage.messagesUsed;

      if (used >= limit) {
        return { allowed: false, reason: 'Message limit reached' };
      }

      return { allowed: true, subscription: sub };
    } catch (error) {
      console.error('Gatekeeper Error:', error);
      // در صورت ارور سرور، موقتا اجازه ندهیم بهتر است یا اجازه دهیم؟ اینجا بلاک می‌کنیم.
      return { allowed: false, reason: 'Server Error' };
    }
  },

  checkFeatureAccess: (subscription, featureName) => {
    if (subscription?.currentFeatures?.[featureName] === true) return true;
    return false;
  },

  checkAiLimit: async (subscription) => {
    const limit = subscription.currentLimits.aiTokenLimit || 0;
    const used = subscription.usage.aiTokensUsed || 0;
    return used < limit;
  },

  incrementAiUsage: async (subscriptionId, tokensUsed) => {
    try {
      await Subscription.findByIdAndUpdate(subscriptionId, {
        $inc: { 'usage.messagesUsed': 1, 'usage.aiTokensUsed': tokensUsed },
      });
    } catch (e) {}
  },

  incrementUsage: async (subscriptionId) => {
    try {
      await Subscription.findByIdAndUpdate(subscriptionId, {
        $inc: { 'usage.messagesUsed': 1 },
      });
    } catch (e) {}
  },
};

module.exports = subscriptionManager;
