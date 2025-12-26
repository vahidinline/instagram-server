const IGConnections = require('../models/IG-Connections');
const WebConnection = require('../models/WebConnection'); // ✅ اضافه شد
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');
const mongoose = require('mongoose');

const subscriptionManager = {
  /**
   * بررسی محدودیت ارسال پیام و اعتبار اشتراک
   * @param {string} accountId - شناسه اکانت اینستاگرام یا شناسه کانال وب
   * @param {string} platform - 'instagram' یا 'web'
   */
  checkLimit: async (accountId, platform = 'instagram') => {
    try {
      let userId = null;

      // --- 1. پیدا کردن صاحب اکانت (User ID) ---

      // الف) اگر پلتفرم وب است یا فرمت ID شبیه فرمت مونگو است
      if (
        platform === 'web' ||
        (mongoose.Types.ObjectId.isValid(accountId) && accountId.length === 24)
      ) {
        const webConnection = await WebConnection.findById(accountId);
        if (webConnection) {
          userId = webConnection.user_id;
          // اطمینان حاصل میکنیم که پلتفرم درست ست شده باشد برای لاگ‌های بعدی
          platform = 'web';
        }
      }

      // ب) اگر در وب پیدا نشد یا پلتفرم اینستاگرام بود
      if (!userId) {
        const igConnection = await IGConnections.findOne({
          ig_userId: accountId,
        });
        if (igConnection) {
          userId = igConnection.user_id;
          platform = 'instagram';
        }
      }

      // ج) اگر کلا پیدا نشد
      if (!userId) {
        console.error(
          `❌ Gatekeeper: Account/Channel not found for ID: ${accountId}`
        );
        return { allowed: false, reason: 'Account not found' };
      }

      // --- 2. پیدا کردن اشتراک فعال ---
      let sub = await Subscription.findOne({
        user_id: userId,
        status: 'active',
      });

      // *** فیکس خودکار (Auto-fix): اگر اشتراک نداشت، پلن رایگان بساز ***
      if (!sub) {
        console.log(
          `⚠️ User ${userId} has no subscription. Creating FREE plan automatically...`
        );

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

        sub = await Subscription.create({
          user_id: userId,
          plan_id: freePlan._id,
          status: 'active',
          startDate: new Date(),
          endDate: new Date(
            new Date().setFullYear(new Date().getFullYear() + 1)
          ),
          currentLimits: freePlan.limits,
          currentFeatures: freePlan.features,
          usage: { messagesUsed: 0, aiTokensUsed: 0 },
        });
      }

      // --- 3. چک کردن تاریخ انقضا ---
      if (new Date() > sub.endDate) {
        return { allowed: false, reason: 'Subscription expired' };
      }

      // --- 4. چک کردن سقف مصرف پیام ---
      const limit = sub.currentLimits.messageCount;
      const used = sub.usage.messagesUsed;

      if (used >= limit) {
        return { allowed: false, reason: 'Message limit reached' };
      }

      // همه چیز اوکی است
      return { allowed: true, subscription: sub, platform: platform };
    } catch (error) {
      console.error('❌ Gatekeeper Error:', error);
      return { allowed: false, reason: 'Server Error' };
    }
  },

  // چک کردن دسترسی به فیچر خاص (مثلا AI)
  checkFeatureAccess: (subscription, featureName) => {
    if (subscription?.currentFeatures?.[featureName] === true) return true;
    return false;
  },

  // چک کردن توکن باقی‌مانده AI
  checkAiLimit: async (subscription) => {
    const limit = subscription.currentLimits.aiTokenLimit || 0;
    const used = subscription.usage.aiTokensUsed || 0;
    return used < limit;
  },

  // افزایش مصرف توکن AI
  incrementAiUsage: async (subscriptionId, tokensUsed) => {
    try {
      await Subscription.findByIdAndUpdate(subscriptionId, {
        $inc: { 'usage.aiTokensUsed': tokensUsed },
      });
    } catch (e) {
      console.error('Update AI Usage Error:', e);
    }
  },

  // افزایش مصرف پیام
  incrementUsage: async (subscriptionId) => {
    try {
      await Subscription.findByIdAndUpdate(subscriptionId, {
        $inc: { 'usage.messagesUsed': 1 },
      });
    } catch (e) {
      console.error('Update Msg Usage Error:', e);
    }
  },
};

module.exports = subscriptionManager;
