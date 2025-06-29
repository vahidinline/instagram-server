const axios = require('axios'); // must be imported
const igMessages = async (entry, field, value) => {
  const comment = value;

  const aiPayload = {
    userId: entry.id, // Use entry.id as userId
    igAccountId: entry.id,
    eventType: 'message',
    eventPayload: {
      text: comment.text,
      id: comment.id,
      from: comment.from,
    },
  };

  console.log('🤖 AI Payload:', JSON.stringify(aiPayload, null, 2));

  try {
    const response = await axios.post(
      'https://mcp.vahidafshari.com/webhook/ig-ai-reply',
      aiPayload
    );
    console.log('✅ Sent to n8n. AI response:', response.data);
    const aiReply = response.data;
    console.log('🤖 AI response:', aiReply);

    // Reply to comment using Instagram Graph API
    const replyRes = await axios.post(
      `https://graph.instagram.com/v23.0/${comment.id}/replies`,
      {
        message: aiReply,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        params: {
          access_token: process.env.IG_USER_TOKEN, // Use your token securely
        },
      }
    );

    console.log('✅ Successfully replied to comment:', replyRes);
    return res.status(200).json({ success: true, aiReply });
  } catch (err) {
    console.error(
      '❌ Error sending to n8n:',
      err.response?.data || err.message
    );
  }
};

module.exports = igMessages;
