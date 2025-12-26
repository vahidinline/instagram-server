(function () {
  // 1. تنظیمات اولیه
  const SCRIPT_TAG = document.currentScript;
  // دریافت آدرس سرور از روی آدرس فایل اسکریپت
  const SERVER_URL = new URL(SCRIPT_TAG.src).origin;
  // دریافت آی‌دی کانال (که کاربر در پنل گرفته)
  const CHANNEL_ID = window.BUSINESS_BOT_ID;

  if (!CHANNEL_ID) {
    console.error('BusinessBot: CHANNEL_ID not defined.');
    return;
  }

  // تولید شناسه مهمان (Guest ID) برای حفظ تاریخچه چت کاربر
  let guestId = localStorage.getItem('bb_guest_id');
  if (!guestId) {
    guestId = 'guest_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('bb_guest_id', guestId);
  }

  // 2. تزریق استایل‌ها (CSS)
  const style = document.createElement('style');
  style.innerHTML = `
        #bb-widget-container {
            position: fixed; bottom: 20px; right: 20px; z-index: 999999;
            font-family: system-ui, -apple-system, sans-serif;
        }
        #bb-chat-btn {
            width: 60px; height: 60px; border-radius: 50%;
            background: #4F46E5; color: white; border: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15); cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            transition: transform 0.2s;
        }
        #bb-chat-btn:hover { transform: scale(1.05); }
        #bb-chat-window {
            position: absolute; bottom: 80px; right: 0;
            width: 350px; height: 500px; max-height: 80vh;
            background: white; border-radius: 16px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.2);
            display: none; flex-direction: column; overflow: hidden;
            border: 1px solid #e5e7eb;
        }
        #bb-header {
            background: #4F46E5; color: white; padding: 16px;
            font-weight: bold; display: flex; justify-content: space-between;
        }
        #bb-messages {
            flex: 1; overflow-y: auto; padding: 16px;
            display: flex; flex-direction: column; gap: 10px; background: #f9fafb;
        }
        .bb-msg {
            max-width: 80%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.5;
        }
        .bb-msg-user {
            align-self: flex-end; background: #4F46E5; color: white;
            border-bottom-left-radius: 2px;
        }
        .bb-msg-bot {
            align-self: flex-start; background: white; color: #374151;
            border: 1px solid #e5e7eb; border-bottom-right-radius: 2px;
        }
        #bb-input-area {
            padding: 12px; border-top: 1px solid #e5e7eb; background: white; display: flex; gap: 8px;
        }
        #bb-input {
            flex: 1; border: 1px solid #d1d5db; border-radius: 8px;
            padding: 8px 12px; outline: none; font-size: 14px;
        }
        #bb-send {
            background: #4F46E5; color: white; border: none;
            padding: 8px 16px; border-radius: 8px; cursor: pointer;
        }
        /* Product Card Style */
        .bb-product-card {
            background: white; border: 1px solid #e5e7eb; border-radius: 12px;
            overflow: hidden; margin-top: 5px; width: 100%;
        }
        .bb-product-img { width: 100%; height: 120px; object-fit: cover; }
        .bb-product-body { padding: 10px; }
        .bb-product-title { font-weight: bold; font-size: 13px; margin-bottom: 5px; }
        .bb-product-price { color: #16a34a; font-size: 12px; font-weight: bold; }
        .bb-product-btn {
            display: block; width: 100%; text-align: center;
            background: #f3f4f6; color: #374151; text-decoration: none;
            padding: 6px; margin-top: 8px; border-radius: 6px; font-size: 12px;
        }
    `;
  document.head.appendChild(style);

  // 3. ساخت HTML
  const container = document.createElement('div');
  container.id = 'bb-widget-container';
  container.innerHTML = `
        <div id="bb-chat-window">
            <div id="bb-header">
                <span>پشتیبانی هوشمند</span>
                <span style="cursor:pointer" id="bb-close">✕</span>
            </div>
            <div id="bb-messages"></div>
            <div id="bb-input-area">
                <input type="text" id="bb-input" placeholder="پیام خود را بنویسید..." />
                <button id="bb-send">➤</button>
            </div>
        </div>
        <button id="bb-chat-btn">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
        </button>
    `;
  document.body.appendChild(container);

  // 4. لاجیک سوکت (لود کردن کتابخانه Socket.io از CDN)
  const script = document.createElement('script');
  script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
  script.onload = initSocket;
  document.head.appendChild(script);

  let socket;
  const messagesDiv = document.getElementById('bb-messages');
  const input = document.getElementById('bb-input');

  function initSocket() {
    socket = io(SERVER_URL);

    // عضویت در روم اختصاصی این کاربر مهمان
    // فرمت روم: web_CHANNELID_GUESTID
    const roomName = `web_${CHANNEL_ID}_${guestId}`;
    socket.emit('join_room', roomName);

    socket.on('new_message', (msg) => {
      if (msg.direction === 'outgoing') {
        addMessage(msg.content, 'bot', msg.products);
      }
    });
  }

  function addMessage(text, sender, products = null) {
    const div = document.createElement('div');
    div.className = `bb-msg bb-msg-${sender}`;
    div.innerText = text;

    // اگر محصولی همراه پیام بود (آرایه products)
    if (products && products.length > 0) {
      products.forEach((p) => {
        const card = document.createElement('div');
        card.className = 'bb-product-card';
        card.innerHTML = `
                    <img src="${
                      p.image || 'https://placehold.co/300x200'
                    }" class="bb-product-img"/>
                    <div class="bb-product-body">
                        <div class="bb-product-title">${p.name}</div>
                        <div class="bb-product-price">${parseInt(
                          p.price
                        ).toLocaleString()} تومان</div>
                        <a href="${
                          p.permalink
                        }" target="_blank" class="bb-product-btn">مشاهده محصول</a>
                    </div>
                `;
        div.appendChild(card);
      });
    }

    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  // رویدادهای کلیک
  const toggle = () => {
    const win = document.getElementById('bb-chat-window');
    win.style.display = win.style.display === 'flex' ? 'none' : 'flex';
  };

  document.getElementById('bb-chat-btn').onclick = toggle;
  document.getElementById('bb-close').onclick = toggle;

  const sendMessage = () => {
    const text = input.value.trim();
    if (!text) return;

    addMessage(text, 'user');
    input.value = '';

    // ارسال پیام به سرور (از طریق API HTTP برای پردازش کامل)
    fetch(`${SERVER_URL}/api/channels/web/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: CHANNEL_ID,
        guestId: guestId,
        message: text,
      }),
    });
  };

  document.getElementById('bb-send').onclick = sendMessage;
  input.onkeypress = (e) => e.key === 'Enter' && sendMessage();
})();
