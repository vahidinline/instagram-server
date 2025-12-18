const IGConnections = require('../models/IG-Connections');
const Subscription = require('../models/Subscription');

const subscriptionManager = {
  checkLimit: async (igAccountId) => {
    try {
      const connection = await IGConnections.findOne({
        ig_userId: igAccountId,
      });
      if (!connection) return { allowed: false, reason: 'Account not found' };

      const sub = await Subscription.findOne({
        user_id: connection.user_id,
        status: 'active',
      });

      if (!sub) return { allowed: false, reason: 'No active subscription' };

      if (new Date() > sub.endDate) {
        sub.status = 'expired';
        await sub.save();
        return { allowed: false, reason: 'Subscription expired' };
      }

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

  // *** تابع جدید: بررسی اعتبار توکن ***
  checkAiLimit: async (subscription) => {
    const limit = subscription.currentLimits.aiTokenLimit || 0;
    const used = subscription.usage.aiTokensUsed || 0;

    if (used >= limit) {
      console.log(`⛔ AI Token Limit Reached (${used}/${limit})`);
      return false;
    }
    return true;
  },

  // *** تابع جدید: افزایش مصرف (پیام + توکن) ***
  incrementAiUsage: async (subscriptionId, tokensUsed) => {
    try {
      await Subscription.findByIdAndUpdate(subscriptionId, {
        $inc: {
          'usage.messagesUsed': 1, // یک پیام مصرف شد
          'usage.aiTokensUsed': tokensUsed, // تعداد دقیق توکن کسر شد
        },
      });
      console.log(
        `📉 Deducted ${tokensUsed} tokens from sub ${subscriptionId}`
      );
    } catch (error) {
      console.error('Usage Increment Error:', error);
    }
  },

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
