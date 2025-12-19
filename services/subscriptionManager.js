const IGConnections = require('../models/IG-Connections');
const Subscription = require('../models/Subscription');

const subscriptionManager = {
  // چک کردن کلی (تاریخ و تعداد پیام)
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

      if (sub.usage.messagesUsed >= sub.currentLimits.messageCount) {
        return { allowed: false, reason: 'Message limit reached' };
      }

      return { allowed: true, subscription: sub };
    } catch (error) {
      console.error('Gatekeeper Error:', error);
      return { allowed: false, reason: 'Server Error' };
    }
  },

  // *** جدید: چک کردن دسترسی به ویژگی خاص (مثل AI) ***
  checkFeatureAccess: (subscription, featureName) => {
    // featureName مثلا 'aiAccess'
    if (
      subscription &&
      subscription.currentFeatures &&
      subscription.currentFeatures[featureName] === true
    ) {
      return true;
    }
    console.log(`⛔ Feature Denied: ${featureName}`);
    return false;
  },

  // چک کردن اعتبار توکن AI
  checkAiLimit: async (subscription) => {
    const limit = subscription.currentLimits.aiTokenLimit || 0;
    const used = subscription.usage.aiTokensUsed || 0;
    if (used >= limit) {
      console.log(`⛔ AI Token Limit Reached (${used}/${limit})`);
      return false;
    }
    return true;
  },

  incrementAiUsage: async (subscriptionId, tokensUsed) => {
    try {
      await Subscription.findByIdAndUpdate(subscriptionId, {
        $inc: { 'usage.messagesUsed': 1, 'usage.aiTokensUsed': tokensUsed },
      });
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
