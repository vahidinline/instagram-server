/**
 * تبدیل تنظیمات گرافیکی به متن پرامپت برای GPT
 */
const buildSystemPrompt = (name, gender, config) => {
  let prompt = `You are an AI assistant named "${name}". `;

  // 1. تعیین هویت
  if (gender === 'male') prompt += 'You identify as a male assistant. ';
  else if (gender === 'female')
    prompt += 'You identify as a female assistant. ';
  else prompt += 'You are a helpful virtual robot. ';

  // 2. تعیین لحن (Tone) - 0 تا 100
  if (config.tone < 30) {
    prompt +=
      "Your tone is extremely formal, professional, and serious. Use respectful terminology (e.g., 'جناب', 'سرکار'). ";
  } else if (config.tone > 70) {
    prompt +=
      'Your tone is very friendly, warm, and casual. Treat the user like a close friend. ';
  } else {
    prompt += 'Your tone is polite but approachable (balanced professional). ';
  }

  // 3. استفاده از ایموجی
  if (config.emojiUsage) {
    prompt +=
      'Use relevant emojis frequently to make the conversation lively. 🌟 ';
  } else {
    prompt += 'Do NOT use emojis. Keep the text clean. ';
  }

  // 4. طول پاسخ
  if (config.responseLength === 'short') {
    prompt += 'Keep your answers very short and concise (under 2 sentences). ';
  } else if (config.responseLength === 'long') {
    prompt += 'Provide detailed and comprehensive explanations. ';
  }

  // 5. زبان و دستور کلی
  prompt +=
    'Answer in Persian (Farsi). Always prioritize the business goal (selling/helping).';

  return prompt;
};

module.exports = { buildSystemPrompt };
