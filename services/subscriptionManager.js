const IGConnections = require('../models/IG-Connections');
const Subscription = require('../models/Subscription');

const subscriptionManager = {
  checkLimit: async (igAccountId) => {
    console.log(`🛡️ GATEKEEPER: Checking limit for IG: ${igAccountId}`);

    try {
      // 1. پیدا کردن اکانت اینستاگرام
      const connection = await IGConnections.findOne({
        ig_userId: igAccountId,
      });

      if (!connection) {
        console.error(`❌ GATEKEEPER: Connection not found for ${igAccountId}`);
        return { allowed: false, reason: 'IG Connection not found in DB' };
      }

      console.log(`👤 Owner User ID: ${connection.user_id}`);

      // 2. پیدا کردن اشتراک
      const sub = await Subscription.findOne({
        user_id: connection.user_id,
        status: 'active',
      });

      if (!sub) {
        console.error(
          `❌ GATEKEEPER: No active subscription found for User ${connection.user_id}`
        );
        // لاگ برای دیباگ: آیا اصلا اشتراکی برای این یوزر هست؟
        const anySub = await Subscription.find({ user_id: connection.user_id });
        console.log('   -> Found other subs?', anySub);

        return { allowed: false, reason: 'No active subscription' };
      }

      // 3. چک تاریخ
      if (new Date() > sub.endDate) {
        console.error('❌ GATEKEEPER: Subscription expired');
        sub.status = 'expired';
        await sub.save();
        return { allowed: false, reason: 'Subscription expired' };
      }

      // 4. چک مصرف
      const limit = sub.currentLimits.messageCount;
      const used = sub.usage.messagesUsed;

      console.log(`📊 Usage: ${used} / ${limit}`);

      if (used >= limit) {
        console.error('❌ GATEKEEPER: Limit reached');
        return { allowed: false, reason: 'Message limit reached' };
      }

      return { allowed: true, subscription: sub };
    } catch (error) {
      console.error('🔥 GATEKEEPER ERROR:', error);
      return { allowed: false, reason: 'Server Logic Error' };
    }
  },

  incrementUsage: async (subscriptionId) => {
    try {
      const res = await Subscription.findByIdAndUpdate(
        subscriptionId,
        {
          $inc: { 'usage.messagesUsed': 1 },
        },
        { new: true }
      );
      console.log(`📈 Usage Updated: ${res.usage.messagesUsed}`);
    } catch (error) {
      console.error('Usage Increment Error:', error);
    }
  },
};

module.exports = subscriptionManager;
