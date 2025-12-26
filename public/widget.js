(function () {
  // 1. تنظیمات سرور
  let SERVER_URL =
    'https://victorious-ground-2c6d3c53938045c3bdad52df58ae27c8.azurewebsites.net';
  try {
    if (document.currentScript && document.currentScript.src) {
      SERVER_URL = new URL(document.currentScript.src).origin;
    }
  } catch (e) {}

  const CHANNEL_ID = window.BUSINESS_BOT_ID;
  if (!CHANNEL_ID) return console.error('BusinessBot: ID Missing');

  // 2. ساخت Host
  const host = document.createElement('div');
  host.id = 'business-bot-host';
  host.style.position = 'fixed';
  host.style.bottom = '20px';
  host.style.right = '20px';
  // z-index بسیار بالا برای اطمینان از اینکه روی همه چیز است
  host.style.zIndex = '2147483647';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // 3. استایل‌ها
  const style = document.createElement('style');
  style.textContent = `
        :host { all: initial; font-family: system-ui, -apple-system, sans-serif; }
        .wrapper {
            position: fixed; bottom: 20px; right: 20px;
            display: flex; flex-direction: column; align-items: flex-end;
            gap: 15px; z-index: 99999;
        }
        .fab {
            width: 60px; height: 60px; border-radius: 50%;
            background: #4F46E5; color: white; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            transition: transform 0.2s; border: none; outline: none;
        }
        .fab:hover { transform: scale(1.05); }
        .fab svg { width: 30px; height: 30px; }

        .chat-window {
            width: 350px; height: 500px; max-height: 70vh;
            background: white; border-radius: 16px;
            box-shadow: 0 5px 30px rgba(0,0,0,0.2);
            display: none; flex-direction: column; overflow: hidden;
            border: 1px solid #e5e7eb; animation: slideUp 0.3s ease-out;
            margin-bottom: 5px;
        }
        .chat-window.open { display: flex; }

        @keyframes slideUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .header {
            background: linear-gradient(135deg, #4F46E5, #6366f1);
            padding: 16px; color: white; font-weight: bold;
            display: flex; justify-content: space-between; align-items: center;
        }
        .messages {
            flex: 1; overflow-y: auto; padding: 15px;
            display: flex; flex-direction: column; gap: 10px;
            background: #f9fafb;
        }
        .msg {
            max-width: 85%; padding: 10px 14px; border-radius: 12px;
            font-size: 13px; line-height: 1.5; word-wrap: break-word;
        }
        .msg-user { align-self: flex-end; background: #4F46E5; color: white; border-bottom-left-radius: 2px; }
        .msg-bot { align-self: flex-start; background: white; color: #1f2937; border: 1px solid #e5e7eb; border-bottom-right-radius: 2px; }

        .input-area {
            padding: 12px; border-top: 1px solid #e5e7eb; background: white;
            display: flex; gap: 8px; align-items: center;
        }
        input {
            flex: 1; border: 1px solid #d1d5db; border-radius: 24px;
            padding: 10px 16px; outline: none; font-size: 14px;
            background: #f9fafb; color: #1f2937;
        }
        input:focus { border-color: #4F46E5; background: white; }

        .send-btn {
            background: #4F46E5; color: white; border: none;
            width: 40px; height: 40px; border-radius: 50%;
            cursor: pointer; display: flex; align-items: center; justify-content: center;
        }

        .product-card {
            background: white; border: 1px solid #e5e7eb; border-radius: 8px;
            overflow: hidden; margin-top: 5px; width: 100%;
        }
        .product-img { width: 100%; height: 120px; object-fit: cover; }
        .product-body { padding: 10px; }
        .product-title { font-weight: bold; font-size: 12px; margin-bottom: 5px; color: #111; }
        .product-price { color: #16a34a; font-size: 13px; font-weight: bold; }
        .product-btn {
            display: block; width: 100%; text-align: center;
            background: #f3f4f6; color: #374151; text-decoration: none;
            padding: 8px; margin-top: 8px; border-radius: 6px; font-size: 12px; font-weight: bold;
        }
    `;
  shadow.appendChild(style);

  // 4. HTML
  const wrapper = document.createElement('div');
  wrapper.className = 'wrapper';
  wrapper.innerHTML = `
        <div class="chat-window" id="chat-window">
            <div class="header">
                <span style="display:flex; align-items:center; gap:6px;">
                    <span style="width:8px; height:8px; background:#4ade80; border-radius:50%;"></span>
                    پشتیبانی آنلاین
                </span>
                <span id="close-btn" style="cursor:pointer;">✕</span>
            </div>
            <div class="messages" id="messages"></div>
            <div class="input-area">
                <input type="text" id="msg-input" placeholder="اینجا بنویسید..." autocomplete="off">
                <button class="send-btn" id="send-btn">➤</button>
            </div>
        </div>
        <button class="fab" id="fab">
            <svg id="icon-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            <svg id="icon-close" style="display:none;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
    `;
  shadow.appendChild(wrapper);

  // 5. Logic
  if (!window.io) {
    const script = document.createElement('script');
    script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
    script.onload = initLogic;
    document.head.appendChild(script);
  } else {
    initLogic();
  }

  function initLogic() {
    const socket = io(SERVER_URL);
    let guestId = localStorage.getItem('bb_guest_id');
    if (!guestId) {
      guestId = 'guest_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('bb_guest_id', guestId);
    }

    const roomName = `web_${CHANNEL_ID}_${guestId}`;
    socket.emit('join_room', roomName);

    socket.on('new_message', (msg) => {
      if (msg.direction === 'outgoing') {
        addMessage(msg.content, 'bot', msg.products);
      }
    });

    const chatWindow = shadow.getElementById('chat-window');
    const fab = shadow.getElementById('fab');
    const iconChat = shadow.getElementById('icon-chat');
    const iconClose = shadow.getElementById('icon-close');
    const messagesDiv = shadow.getElementById('messages');
    const input = shadow.getElementById('msg-input');
    const sendBtn = shadow.getElementById('send-btn');
    const closeBtn = shadow.getElementById('close-btn');

    // *** FIX: جلوگیری از دزدی فوکوس توسط وردپرس ***
    // این بخش حیاتی است: رویدادهای کیبورد را در همینجا نگه میداریم
    const stopPropagation = (e) => {
      e.stopPropagation();
    };

    // گوش دادن به همه نوع رویداد کلید و جلوگیری از انتشار
    input.addEventListener('keydown', stopPropagation);
    input.addEventListener('keypress', stopPropagation);
    input.addEventListener('keyup', stopPropagation);

    // هندل کردن اینتر به صورت دستی
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault(); // جلوگیری از submit فرم‌های وردپرس
        sendMessage();
      }
    });

    let isOpen = false;

    const toggle = () => {
      isOpen = !isOpen;
      if (isOpen) {
        chatWindow.classList.add('open');
        iconChat.style.display = 'none';
        iconClose.style.display = 'block';
        // فوکوس با تاخیر کم
        setTimeout(() => input.focus(), 100);
      } else {
        chatWindow.classList.remove('open');
        iconChat.style.display = 'block';
        iconClose.style.display = 'none';
      }
    };

    fab.onclick = toggle;
    closeBtn.onclick = toggle;

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
      }).catch(console.error);
    };

    sendBtn.onclick = sendMessage;

    if (messagesDiv.children.length === 0) {
      addMessage('سلام! 👋 چطور میتونم کمکتون کنم؟', 'bot');
    }

    function addMessage(text, sender, products) {
      if (!text && !products) return;
      const div = document.createElement('div');
      div.className = `msg msg-${sender}`;
      div.innerText = text || '';

      if (products && products.length > 0) {
        products.forEach((p) => {
          const card = document.createElement('div');
          card.className = 'product-card';
          card.innerHTML = `
                        <img src="${
                          p.image || 'https://via.placeholder.com/150'
                        }" class="product-img"/>
                        <div class="product-body">
                            <div class="product-title">${p.name}</div>
                            <div class="product-price">${parseInt(
                              p.price
                            ).toLocaleString()} تومان</div>
                            <a href="${
                              p.permalink
                            }" target="_blank" class="product-btn">مشاهده محصول</a>
                        </div>
                    `;
          div.appendChild(card);
        });
      }
      messagesDiv.appendChild(div);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
  }
})();
