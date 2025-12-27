(function () {
  // ---------------------------------------------------------
  // 1. تنظیمات اولیه و تشخیص سرور
  // ---------------------------------------------------------
  let SERVER_URL =
    'https://victorious-ground-2c6d3c53938045c3bdad52df58ae27c8.azurewebsites.net';

  // تلاش برای خواندن آدرس سرور از روی تگ اسکریپت (برای انعطاف‌پذیری)
  try {
    if (document.currentScript && document.currentScript.src) {
      const url = new URL(document.currentScript.src);
      SERVER_URL = url.origin;
    }
  } catch (e) {}

  const CHANNEL_ID = window.BUSINESS_BOT_ID;
  if (!CHANNEL_ID)
    return console.error(
      'BusinessBot: ID Missing. Please set window.BUSINESS_BOT_ID'
    );

  // ---------------------------------------------------------
  // 2. ساخت Shadow DOM (برای ایزوله کردن استایل‌ها)
  // ---------------------------------------------------------
  const host = document.createElement('div');
  host.id = 'business-bot-host';
  host.style.position = 'fixed';
  host.style.bottom = '20px';
  host.style.right = '20px';
  host.style.zIndex = '2147483647'; // Max Z-Index
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // ---------------------------------------------------------
  // 3. استایل‌ها (CSS)
  // ---------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = `
        :host { all: initial; font-family: system-ui, -apple-system, sans-serif; }
        * { box-sizing: border-box; }

        .wrapper {
            position: fixed; bottom: 20px; right: 20px;
            display: flex; flex-direction: column; align-items: flex-end;
            gap: 15px; z-index: 99999;
        }

        /* دکمه شناور (FAB) */
        .fab {
            width: 60px; height: 60px; border-radius: 50%;
            background: #4F46E5; color: white; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            transition: transform 0.2s, background 0.2s; border: none; outline: none;
        }
        .fab:hover { transform: scale(1.05); background: #4338ca; }
        .fab svg { width: 30px; height: 30px; }

        /* پنجره چت */
        .chat-window {
            width: 360px; height: 550px; max-height: 75vh; max-width: 90vw;
            background: white; border-radius: 16px;
            box-shadow: 0 5px 30px rgba(0,0,0,0.15);
            display: none; flex-direction: column; overflow: hidden;
            border: 1px solid #e5e7eb; animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            margin-bottom: 5px;
        }
        .chat-window.open { display: flex; }

        @keyframes slideUp {
            from { opacity: 0; transform: translateY(20px) scale(0.95); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }

        /* هدر */
        .header {
            background: linear-gradient(135deg, #4F46E5, #6366f1);
            padding: 16px; color: white; font-weight: 600;
            display: flex; justify-content: space-between; align-items: center;
            font-size: 15px;
        }
        .status-dot { width: 8px; height: 8px; background: #4ade80; border-radius: 50%; display: inline-block; margin-right: 6px; }

        /* ناحیه پیام‌ها */
        .messages {
            flex: 1; overflow-y: auto; padding: 15px;
            display: flex; flex-direction: column; gap: 12px;
            background: #f9fafb; scroll-behavior: smooth;
        }

        /* حباب‌های پیام */
        .msg {
            max-width: 85%; padding: 10px 14px; border-radius: 12px;
            font-size: 13px; line-height: 1.5; word-wrap: break-word;
            position: relative;
        }
        .msg-user {
            align-self: flex-end;
            background: #4F46E5; color: white;
            border-bottom-left-radius: 2px;
        }
        .msg-bot {
            align-self: flex-start;
            background: white; color: #1f2937;
            border: 1px solid #e5e7eb;
            border-bottom-right-radius: 2px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        }

        /* استایل لینک‌ها */
        .msg a { color: inherit; text-decoration: underline; font-weight: bold; }
        .msg-bot a { color: #4F46E5; }

        /* استایل کارت محصول (Product Card) */
        .products-container {
            display: flex; overflow-x: auto; gap: 10px; padding-bottom: 5px;
            margin-top: 8px; max-width: 100%;
        }
        .products-container::-webkit-scrollbar { height: 4px; }
        .products-container::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 4px; }

        .product-card {
            min-width: 200px; max-width: 200px;
            background: white; border: 1px solid #e5e7eb; border-radius: 8px;
            overflow: hidden; flex-shrink: 0;
            display: flex; flex-direction: column;
        }
        .product-img {
            width: 100%; height: 120px; object-fit: cover; background: #f3f4f6;
        }
        .product-body { padding: 10px; flex: 1; display: flex; flex-direction: column; }
        .product-title {
            font-weight: bold; font-size: 12px; margin-bottom: 4px; color: #111;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .product-desc {
            font-size: 11px; color: #6b7280; margin-bottom: 8px; line-height: 1.3;
            display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
        }
        .product-price { color: #16a34a; font-size: 13px; font-weight: bold; margin-bottom: 8px; margin-top: auto; }
        .product-btn {
            display: block; width: 100%; text-align: center;
            background: #f3f4f6; color: #374151; text-decoration: none;
            padding: 8px; border-radius: 6px; font-size: 12px; font-weight: bold;
            transition: background 0.2s;
        }
        .product-btn:hover { background: #e5e7eb; }

        /* ✅ استایل دکمه‌های گزینه‌ای (Chips) */
        .chips-container {
            display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px;
            justify-content: flex-start;
        }
        .chip-btn {
            background: #ffffff; border: 1px solid #4F46E5; color: #4F46E5;
            padding: 8px 14px; border-radius: 20px; font-size: 12px; font-weight: bold;
            cursor: pointer; transition: all 0.2s; font-family: inherit;
        }
        .chip-btn:hover { background: #4F46E5; color: white; transform: translateY(-1px); box-shadow: 0 2px 5px rgba(79, 70, 229, 0.2); }
        .chip-btn:active { transform: translateY(0); }

        /* ناحیه ورودی */
        .input-area {
            padding: 12px; border-top: 1px solid #e5e7eb; background: white;
            display: flex; gap: 8px; align-items: center;
        }
        input {
            flex: 1; border: 1px solid #d1d5db; border-radius: 24px;
            padding: 10px 16px; outline: none; font-size: 14px;
            background: #f9fafb; color: #1f2937; transition: all 0.2s;
        }
        input:focus { border-color: #4F46E5; background: white; box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.1); }

        .send-btn {
            background: #4F46E5; color: white; border: none;
            width: 40px; height: 40px; border-radius: 50%;
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            transition: transform 0.2s;
        }
        .send-btn:active { transform: scale(0.9); }
        .send-btn:disabled { background: #9ca3af; cursor: not-allowed; }

        /* تایپینگ */
        .typing { font-size: 11px; color: #6b7280; padding: 0 15px 5px; font-style: italic; display: none; }
    `;
  shadow.appendChild(style);

  // ---------------------------------------------------------
  // 4. ساختار HTML
  // ---------------------------------------------------------
  const wrapper = document.createElement('div');
  wrapper.className = 'wrapper';
  wrapper.innerHTML = `
        <div class="chat-window" id="chat-window">
            <div class="header">
                <span style="display:flex; align-items:center;">
                    <span class="status-dot"></span>
                    دستیار هوشمند
                </span>
                <span id="close-btn" style="cursor:pointer; padding: 5px;">✕</span>
            </div>
            <div class="messages" id="messages"></div>
            <div class="typing" id="typing-indicator">درحال نوشتن...</div>
            <div class="input-area">
                <input type="text" id="msg-input" placeholder="سوال خود را بپرسید..." autocomplete="off">
                <button class="send-btn" id="send-btn">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                </button>
            </div>
        </div>
        <button class="fab" id="fab">
            <svg id="icon-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            <svg id="icon-close" style="display:none;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
    `;
  shadow.appendChild(wrapper);

  // ---------------------------------------------------------
  // 5. لاجیک اصلی (JavaScript)
  // ---------------------------------------------------------

  // لود کردن Socket.io اگر وجود نداشته باشد
  if (!window.io) {
    const script = document.createElement('script');
    script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
    script.onload = initApp;
    document.head.appendChild(script);
  } else {
    initApp();
  }

  function initApp() {
    // A. تولید/بازیابی شناسه کاربر مهمان
    let guestId = localStorage.getItem('bb_guest_id');
    if (!guestId) {
      guestId = 'guest_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('bb_guest_id', guestId);
    }

    // B. اتصال به سوکت
    const socket = io(SERVER_URL);
    const roomName = `web_${CHANNEL_ID}_${guestId}`;
    socket.emit('join_room', roomName);

    // C. دریافت پیام از سرور
    socket.on('new_message', (msg) => {
      // فقط پیام‌های خروجی (از سمت ربات) را نمایش بده
      if (msg.direction === 'outgoing') {
        hideTyping();
        // ✅ پاس دادن دکمه‌ها به تابع نمایش
        addMessage(msg.content, 'bot', msg.products, msg.buttons);
      }
    });

    // دریافت خطا
    socket.on('error_message', (data) => {
      hideTyping();
      addMessage(`⚠️ خطا: ${data.message}`, 'bot');
    });

    // D. المان‌های DOM
    const chatWindow = shadow.getElementById('chat-window');
    const fab = shadow.getElementById('fab');
    const iconChat = shadow.getElementById('icon-chat');
    const iconClose = shadow.getElementById('icon-close');
    const messagesDiv = shadow.getElementById('messages');
    const input = shadow.getElementById('msg-input');
    const sendBtn = shadow.getElementById('send-btn');
    const closeBtn = shadow.getElementById('close-btn');
    const typingInd = shadow.getElementById('typing-indicator');

    // E. توابع کمکی
    const showTyping = () => {
      typingInd.style.display = 'block';
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    };
    const hideTyping = () => {
      typingInd.style.display = 'none';
    };

    // F. تشخیص محصول (Context Detection)
    // این تابع بررسی می‌کند آیا کاربر در صفحه محصول ووکامرس است یا نه
    function detectContext() {
      let context = {
        url: window.location.href,
        productId: null,
      };

      // روش 1: جستجو در تگ input مخفی ووکامرس
      const wooInput = document.querySelector('input[name="add-to-cart"]');
      if (wooInput) {
        context.productId = wooInput.value;
      }
      // روش 2: جستجو در کلاس‌های body (مثلا postid-1234)
      else {
        const classes = document.body.className.split(' ');
        const postClass = classes.find(
          (c) => c.startsWith('postid-') || c.startsWith('product-id-')
        );
        if (postClass) {
          context.productId = postClass.split('-')[1];
        }
      }

      // روش 3: متا تگ‌ها
      if (!context.productId) {
        const metaId = document.querySelector(
          'meta[property="product:retailer_item_id"]'
        );
        if (metaId) context.productId = metaId.content;
      }

      return context;
    }

    // ✅ تابع تبدیل متن به HTML (لینک‌ها)
    function formatText(text) {
      if (!text) return '';

      // 1. تبدیل لینک‌های Markdown: [Text](Url)
      let formatted = text.replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank">$1</a>'
      );

      // 2. تبدیل لینک‌های خام: http...
      formatted = formatted.replace(
        /(?<!href="|">)(https?:\/\/[^\s<]+)/g,
        '<a href="$1" target="_blank">$1</a>'
      );

      // 3. تبدیل خط جدید
      formatted = formatted.replace(/\n/g, '<br>');

      return formatted;
    }

    // G. افزودن پیام به صفحه (آپدیت شده برای Chips)
    function addMessage(text, sender, products = null, buttons = null) {
      if (!text && !products && !buttons) return;

      const div = document.createElement('div');
      div.className = `msg msg-${sender}`;

      // متن
      if (text) {
        div.innerHTML = formatText(text);
      }

      // کارت محصول
      if (products && Array.isArray(products) && products.length > 0) {
        const container = document.createElement('div');
        container.className = 'products-container';

        products.forEach((p) => {
          const card = document.createElement('div');
          card.className = 'product-card';
          const imgUrl =
            p.image_url ||
            p.image ||
            'https://placehold.co/200x120?text=No+Image';

          card.innerHTML = `
                <img src="${imgUrl}" class="product-img" loading="lazy" />
                <div class="product-body">
                    <div class="product-title" title="${p.title || p.name}">${
            p.title || p.name
          }</div>
                    <div class="product-desc">${p.description || ''}</div>
                    <div class="product-price">${p.subtitle || p.price}</div>
                    <a href="${
                      p.default_action_url || p.permalink || '#'
                    }" target="_blank" class="product-btn">مشاهده و خرید</a>
                </div>
            `;
          container.appendChild(card);
        });
        div.appendChild(container);
      }

      // ✅ دکمه‌های گزینه‌ای (Option Chips)
      if (buttons && Array.isArray(buttons) && buttons.length > 0) {
        const chipsDiv = document.createElement('div');
        chipsDiv.className = 'chips-container';

        buttons.forEach((btn) => {
          const chip = document.createElement('button');
          chip.className = 'chip-btn';
          chip.innerText = btn.title;

          // هندلر کلیک روی چیپس
          chip.onclick = () => {
            // 1. پاک کردن دکمه‌ها (برای اینکه دوباره نتواند کلیک کند - اختیاری)
            chipsDiv.remove();

            // 2. نمایش متن دکمه به عنوان پیام کاربر
            addMessage(btn.title, 'user');
            showTyping();

            // 3. ارسال به سرور
            const metadata = detectContext();
            fetch(`${SERVER_URL}/api/channels/web/message`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                channelId: CHANNEL_ID,
                guestId: guestId,
                message: btn.payload || btn.title, // ارسال پی‌لود یا تایتل
                metadata: metadata,
              }),
            }).catch(console.error);
          };

          chipsDiv.appendChild(chip);
        });
        div.appendChild(chipsDiv);
      }

      messagesDiv.appendChild(div);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    // H. ارسال پیام متنی
    const sendMessage = async () => {
      const text = input.value.trim();
      if (!text) return;

      addMessage(text, 'user');
      input.value = '';
      showTyping();

      const metadata = detectContext();

      try {
        await fetch(`${SERVER_URL}/api/channels/web/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelId: CHANNEL_ID,
            guestId: guestId,
            message: text,
            metadata: metadata,
          }),
        });
      } catch (err) {
        console.error('Bot Error:', err);
        hideTyping();
        addMessage('خطا در اتصال به سرور.', 'bot');
      }
    };

    // I. هندل کردن رویدادهای UI
    let isOpen = false;
    const toggleChat = () => {
      isOpen = !isOpen;
      if (isOpen) {
        chatWindow.classList.add('open');
        iconChat.style.display = 'none';
        iconClose.style.display = 'block';
        setTimeout(() => input.focus(), 100);
      } else {
        chatWindow.classList.remove('open');
        iconChat.style.display = 'block';
        iconClose.style.display = 'none';
      }
    };

    fab.onclick = toggleChat;
    closeBtn.onclick = toggleChat;
    sendBtn.onclick = sendMessage;

    // J. رفع باگ دزدی فوکوس و اینتر
    const stopPropagation = (e) => e.stopPropagation();
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        sendMessage();
      }
    });
    input.addEventListener('keypress', stopPropagation);
    input.addEventListener('keyup', stopPropagation);
    input.addEventListener('focus', stopPropagation);

    // K. دریافت کانفیگ اولیه
    fetch(`${SERVER_URL}/api/channels/config/${CHANNEL_ID}`)
      .then((res) => res.json())
      .then((config) => {
        if (config.welcomeMessage && messagesDiv.children.length === 0) {
          addMessage(config.welcomeMessage, 'bot');
        }
        if (config.color) {
          fab.style.background = config.color;
          const header = shadow.querySelector('.header');
          if (header)
            header.style.background = `linear-gradient(135deg, ${config.color}, #6366f1)`;
        }
      })
      .catch(() => {
        if (messagesDiv.children.length === 0) {
          addMessage('سلام! چطور میتونم کمکتون کنم؟', 'bot');
        }
      });
  }
})();
