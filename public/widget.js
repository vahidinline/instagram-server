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

  // 2. ساخت کانتینر Iframe (در صفحه اصلی وردپرس)
  const container = document.createElement('div');
  container.id = 'bb-widget-root';
  Object.assign(container.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    width: '70px', // سایز اولیه (فقط دکمه)
    height: '70px',
    zIndex: '2147483647', // بالاترین لایه ممکن
    border: 'none',
    transition: 'all 0.3s ease',
  });

  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, {
    width: '100%',
    height: '100%',
    border: 'none',
    borderRadius: '16px', // گردی گوشه‌ها (برای دکمه اولیه هم خوبه)
    overflow: 'hidden',
  });
  iframe.setAttribute('allow', 'autoplay'); // اجازه پخش صدا
  container.appendChild(iframe);
  document.body.appendChild(container);

  // 3. ارتباط بین Iframe و سایت اصلی (برای تغییر سایز)
  window.addEventListener('message', (event) => {
    if (event.data === 'bb-open') {
      container.style.width = '360px';
      container.style.height = '600px';
      container.style.boxShadow = '0 10px 40px rgba(0,0,0,0.2)';
    } else if (event.data === 'bb-close') {
      container.style.width = '70px';
      container.style.height = '70px';
      container.style.boxShadow = 'none';
    }
  });

  // 4. محتوای داخل Iframe (دنیای ایزوله شده)
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="fa" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <style>
            body { margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; overflow: hidden; background: transparent; }

            /* دکمه شناور */
            #fab {
                position: fixed; bottom: 0; right: 0;
                width: 60px; height: 60px; border-radius: 50%;
                background: #4F46E5; color: white; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                transition: transform 0.2s;
                z-index: 100;
            }
            #fab:hover { transform: scale(1.05); }

            /* پنجره چت */
            #chat-window {
                position: absolute; top: 0; left: 0; right: 0; bottom: 80px; /* جا برای دکمه */
                background: white; border-radius: 16px;
                display: none; flex-direction: column;
                box-shadow: 0 0 1px rgba(0,0,0,0.1);
                height: calc(100% - 70px);
                border: 1px solid #e5e7eb;
            }

            /* هدر */
            #header {
                background: linear-gradient(to right, #4F46E5, #6366f1);
                padding: 16px; color: white; font-weight: bold;
                display: flex; justify-content: space-between; align-items: center;
                font-size: 14px;
            }

            /* لیست پیام‌ها */
            #messages {
                flex: 1; overflow-y: auto; padding: 12px;
                display: flex; flex-direction: column; gap: 8px;
                background: #f9fafb;
            }

            .msg { max-width: 85%; padding: 8px 12px; border-radius: 12px; font-size: 13px; line-height: 1.5; word-wrap: break-word; }
            .msg-user { align-self: flex-end; background: #4F46E5; color: white; border-bottom-left-radius: 2px; }
            .msg-bot { align-self: flex-start; background: white; color: #374151; border: 1px solid #e5e7eb; border-bottom-right-radius: 2px; }

            /* اینپوت */
            #input-area {
                padding: 10px; border-top: 1px solid #eee; background: white;
                display: flex; gap: 8px; align-items: center;
            }
            input {
                flex: 1; border: 1px solid #ddd; border-radius: 20px;
                padding: 10px 15px; outline: none; font-size: 14px;
            }
            input:focus { border-color: #4F46E5; }

            button.send-btn {
                background: #4F46E5; color: white; border: none; width: 36px; height: 36px;
                border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center;
            }

            /* Product Card */
            .p-card { background: white; border: 1px solid #eee; border-radius: 8px; overflow: hidden; margin-top: 5px; }
            .p-img { width: 100%; height: 120px; object-fit: cover; }
            .p-body { padding: 8px; }
            .p-title { font-weight: bold; font-size: 12px; margin-bottom: 4px; }
            .p-price { color: #16a34a; font-size: 12px; font-weight: bold; }
            .p-btn { display: block; background: #f3f4f6; color: #333; text-align: center; padding: 6px; text-decoration: none; border-radius: 4px; font-size: 11px; margin-top: 5px; }

            /* وضعیت باز/بسته */
            .open #chat-window { display: flex; }
            .open #fab svg.chat-icon { display: none; }
            .open #fab svg.close-icon { display: block; }

            svg.close-icon { display: none; }
        </style>
    </head>
    <body>
        <div id="app">
            <div id="chat-window">
                <div id="header">
                    <span>پشتیبانی آنلاین</span>
                    <span style="font-size:10px; opacity:0.8">● آنلاین</span>
                </div>
                <div id="messages"></div>
                <div id="input-area">
                    <input type="text" id="msg-input" placeholder="پیام..." autocomplete="off" />
                    <button class="send-btn" id="send-btn">➤</button>
                </div>
            </div>

            <div id="fab">
                <svg class="chat-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                <svg class="close-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </div>
        </div>

        <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
        <script>
            const SERVER_URL = "${SERVER_URL}";
            const CHANNEL_ID = "${CHANNEL_ID}";

            // Guest ID Logic (Inside Iframe Storage)
            let guestId = localStorage.getItem('bb_guest_id');
            if (!guestId) {
                guestId = 'g_' + Math.random().toString(36).substr(2, 9);
                localStorage.setItem('bb_guest_id', guestId);
            }

            const app = document.getElementById('app');
            const fab = document.getElementById('fab');
            const msgsDiv = document.getElementById('messages');
            const input = document.getElementById('msg-input');
            const btn = document.getElementById('send-btn');

            let isOpen = false;
            let socket;

            // Toggle
            fab.onclick = () => {
                isOpen = !isOpen;
                if (isOpen) {
                    app.classList.add('open');
                    window.parent.postMessage('bb-open', '*');
                    input.focus();
                } else {
                    app.classList.remove('open');
                    window.parent.postMessage('bb-close', '*');
                }
            };

            // Socket
            try {
                socket = io(SERVER_URL);
                const roomName = "web_" + CHANNEL_ID + "_" + guestId;
                socket.emit('join_room', roomName);

                socket.on('new_message', (msg) => {
                    if(msg.direction === 'outgoing') {
                        addMsg(msg.content, 'bot', msg.products);
                    }
                });
            } catch(e) { console.error(e); }

            // Add Message
            function addMsg(text, sender, products) {
                if(!text && !products) return;
                const d = document.createElement('div');
                d.className = "msg msg-" + sender;
                d.innerText = text || '';

                if(products && products.length) {
                    products.forEach(p => {
                        const c = document.createElement('div');
                        c.className = "p-card";
                        c.innerHTML = '<img src="'+(p.image||'')+'" class="p-img"><div class="p-body"><div class="p-title">'+p.name+'</div><div class="p-price">'+p.price+'</div><a href="'+p.permalink+'" target="_blank" class="p-btn">خرید</a></div>';
                        d.appendChild(c);
                    });
                }
                msgsDiv.appendChild(d);
                msgsDiv.scrollTop = msgsDiv.scrollHeight;
            }

            // Send
            const send = () => {
                const txt = input.value.trim();
                if(!txt) return;
                addMsg(txt, 'user');
                input.value = '';

                fetch(SERVER_URL + '/api/channels/web/message', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ channelId: CHANNEL_ID, guestId, message: txt })
                });
            };

            btn.onclick = send;
            input.onkeypress = e => e.key === 'Enter' && send();

            // Welcome
            if(msgsDiv.children.length === 0) addMsg("سلام! چطور میتونم کمکتون کنم؟", 'bot');

        </script>
    </body>
    </html>
    `;

  // نوشتن محتوا داخل Iframe
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(htmlContent);
  doc.close();
})();
