(function () {
  // آدرس دقیق سرور آژور خود را اینجا هم محض اطمینان بگذارید
  // (اگر اسکریپت درست لود شود، خط پایین به صورت خودکار آدرس را پیدا میکند، اما برای محکم کاری)
  let SERVER_URL =
    'https://victorious-ground-2c6d3c53938045c3bdad52df58ae27c8.azurewebsites.net';

  try {
    if (document.currentScript && document.currentScript.src) {
      SERVER_URL = new URL(document.currentScript.src).origin;
    }
  } catch (e) {
    console.warn('Could not detect server URL automatically, using fallback.');
  }

  const CHANNEL_ID = window.BUSINESS_BOT_ID;

  if (!CHANNEL_ID) {
    console.error('BusinessBot: CHANNEL_ID not defined.');
    return;
  }

  let guestId = localStorage.getItem('bb_guest_id');
  if (!guestId) {
    guestId = 'guest_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('bb_guest_id', guestId);
  }

  // 2. تزریق استایل‌ها (با Z-Index بسیار بالا و Reset)
  const style = document.createElement('style');
  style.innerHTML = `
        /* کانتینر اصلی - بالاترین لایه */
        #bb-widget-container {
            position: fixed; bottom: 20px; right: 20px;
            z-index: 2147483647; /* Max Z-Index */
            font-family: system-ui, -apple-system, sans-serif;
            direction: rtl;
            line-height: normal;
        }
        /* ریست کردن استایل‌های وردپرس روی ویجت */
        #bb-widget-container * {
            box-sizing: border-box;
        }

        #bb-chat-btn {
            width: 60px; height: 60px; border-radius: 50%;
            background: #4F46E5; color: white; border: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.25); cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            transition: transform 0.2s;
            position: relative;
            z-index: 2147483647;
        }
        #bb-chat-btn:hover { transform: scale(1.05); }

        #bb-chat-window {
            position: absolute; bottom: 80px; right: 0;
            width: 350px; height: 500px; max-height: 70vh;
            background: white; border-radius: 16px;
            box-shadow: 0 5px 25px rgba(0,0,0,0.15);
            display: none; flex-direction: column; overflow: hidden;
            border: 1px solid #e5e7eb;
            z-index: 2147483647;
        }

        #bb-header {
            background: #4F46E5; color: white; padding: 16px;
            font-weight: bold; display: flex; justify-content: space-between;
            align-items: center; font-size: 14px;
        }

        #bb-messages {
            flex: 1; overflow-y: auto; padding: 16px;
            display: flex; flex-direction: column; gap: 10px; background: #f9fafb;
            scroll-behavior: smooth;
        }

        .bb-msg {
            max-width: 85%; padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.6;
            word-wrap: break-word;
        }
        .bb-msg-user {
            align-self: flex-end; background: #4F46E5; color: white;
            border-bottom-left-radius: 2px;
        }
        .bb-msg-bot {
            align-self: flex-start; background: white; color: #374151;
            border: 1px solid #e5e7eb; border-bottom-right-radius: 2px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        }

        #bb-input-area {
            padding: 12px; border-top: 1px solid #e5e7eb; background: white;
            display: flex; gap: 8px; align-items: center;
        }

        /* استایل حیاتی برای اینپوت */
        #bb-input {
            flex: 1;
            border: 1px solid #d1d5db !important;
            border-radius: 20px !important;
            padding: 10px 15px !important;
            outline: none !important;
            font-size: 14px !important;
            background: white !important;
            color: black !important;
            height: auto !important;
            min-height: 40px !important;
            box-shadow: none !important;
            pointer-events: auto !important; /* اطمینان از کلیک‌خوری */
        }
        #bb-input:focus {
            border-color: #4F46E5 !important;
        }

        #bb-send {
            background: #4F46E5; color: white; border: none;
            width: 40px; height: 40px; border-radius: 50%;
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            font-size: 18px; padding: 0; padding-right: 2px;
        }

        /* Product Card */
        .bb-product-card {
            background: white; border: 1px solid #e5e7eb; border-radius: 8px;
            overflow: hidden; margin-top: 8px; width: 100%;
        }
        .bb-product-img { width: 100%; height: 120px; object-fit: cover; }
        .bb-product-body { padding: 8px; }
        .bb-product-title { font-weight: bold; font-size: 12px; margin-bottom: 4px; color: #111; }
        .bb-product-price { color: #16a34a; font-size: 12px; font-weight: bold; }
        .bb-product-btn {
            display: block; width: 100%; text-align: center;
            background: #f3f4f6; color: #374151; text-decoration: none;
            padding: 6px; margin-top: 6px; border-radius: 4px; font-size: 11px;
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
                <span style="cursor:pointer; font-size:18px;" id="bb-close">×</span>
            </div>
            <div id="bb-messages"></div>
            <div id="bb-input-area">
                <input type="text" id="bb-input" placeholder="پیام خود را بنویسید..." autocomplete="off" />
                <button id="bb-send">➤</button>
            </div>
        </div>
        <button id="bb-chat-btn">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
        </button>
    `;
  document.body.appendChild(container);

  // 4. لاجیک سوکت
  const script = document.createElement('script');
  script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
  script.onload = initSocket;
  document.head.appendChild(script);

  let socket;
  const messagesDiv = document.getElementById('bb-messages');
  const input = document.getElementById('bb-input');
  const sendBtn = document.getElementById('bb-send');

  // جلوگیری از بسته شدن هنگام کلیک روی اینپوت (باگ وردپرس)
  input.addEventListener('click', (e) => {
    e.stopPropagation();
    input.focus();
  });

  function initSocket() {
    console.log('BusinessBot: Connecting to', SERVER_URL);
    socket = io(SERVER_URL);

    const roomName = `web_${CHANNEL_ID}_${guestId}`;
    socket.emit('join_room', roomName);

    socket.on('new_message', (msg) => {
      if (msg.direction === 'outgoing') {
        addMessage(msg.content, 'bot', msg.products);
      }
    });

    // پیام خوش‌آمدگویی (اگر چت خالی بود)
    if (messagesDiv.children.length === 0) {
      addMessage('سلام! چطور میتونم کمکتون کنم؟', 'bot');
    }
  }

  function addMessage(text, sender, products = null) {
    if (!text && (!products || products.length === 0)) return;

    const div = document.createElement('div');
    div.className = `bb-msg bb-msg-${sender}`;
    div.innerText = text || '';

    if (products && products.length > 0) {
      products.forEach((p) => {
        const card = document.createElement('div');
        card.className = 'bb-product-card';
        card.innerHTML = `
                    <img src="${
                      p.image || 'https://via.placeholder.com/300'
                    }" class="bb-product-img"/>
                    <div class="bb-product-body">
                        <div class="bb-product-title">${p.name}</div>
                        <div class="bb-product-price">${parseInt(
                          p.price
                        ).toLocaleString()} ت</div>
                        <a href="${
                          p.permalink
                        }" target="_blank" class="bb-product-btn">مشاهده و خرید</a>
                    </div>
                `;
        div.appendChild(card);
      });
    }

    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  // Toggle
  const toggle = () => {
    const win = document.getElementById('bb-chat-window');
    const isClosed = win.style.display === 'none' || win.style.display === '';
    win.style.display = isClosed ? 'flex' : 'none';

    // اگر باز شد، فوکوس کن
    if (isClosed) setTimeout(() => input.focus(), 100);
  };

  document.getElementById('bb-chat-btn').onclick = toggle;
  document.getElementById('bb-close').onclick = toggle;

  const sendMessage = () => {
    const text = input.value.trim();
    if (!text) return;

    addMessage(text, 'user');
    input.value = '';

    fetch(`${SERVER_URL}/api/channels/web/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: CHANNEL_ID,
        guestId: guestId,
        message: text,
      }),
    }).catch((err) => console.error('Send Error:', err));
  };

  sendBtn.onclick = sendMessage;
  input.onkeypress = (e) => e.key === 'Enter' && sendMessage();
})();
