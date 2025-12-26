(function () {
  // 1. یافتن آدرس سرور (خودکار یا دستی)
  let SERVER_URL =
    'https://victorious-ground-2c6d3c53938045c3bdad52df58ae27c8.azurewebsites.net';
  try {
    if (document.currentScript && document.currentScript.src) {
      SERVER_URL = new URL(document.currentScript.src).origin;
    }
  } catch (e) {}

  const CHANNEL_ID = window.BUSINESS_BOT_ID;
  if (!CHANNEL_ID) return console.error('BusinessBot: ID Missing');

  // Guest ID
  let guestId = localStorage.getItem('bb_guest_id');
  if (!guestId) {
    guestId = 'g_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('bb_guest_id', guestId);
  }

  // 2. ساخت کانتینر اصلی (Root)
  // تغییر استراتژی: کانتینر همیشه pointer-events: auto دارد اما سایزش تغییر میکند
  const container = document.createElement('div');
  container.id = 'bb-widget-root';
  Object.assign(container.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    width: '60px', // شروع با سایز دکمه
    height: '60px',
    zIndex: '2147483647', // Max Z-Index
    border: 'none',
    background: 'transparent',
    boxShadow: 'none',
    transition: 'none', // انیمیشن را داخلی هندل میکنیم
  });

  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, {
    width: '100%',
    height: '100%',
    border: 'none',
    borderRadius: '28px', // گردی در حالت بسته (دایره)
    transition: 'border-radius 0.3s ease',
  });
  iframe.setAttribute('allow', 'autoplay; clipboard-write');

  container.appendChild(iframe);
  document.body.appendChild(container);

  // 3. هندلر تغییر سایز (ارتباط با Iframe)
  window.addEventListener('message', (event) => {
    if (event.data === 'bb-open') {
      // حالت باز: سایز بزرگ، گردی کمتر
      container.style.width = '350px';
      container.style.height = '600px';
      container.style.maxHeight = '80vh';
      container.style.boxShadow = '0 5px 40px rgba(0,0,0,0.16)';
      iframe.style.borderRadius = '16px';
    } else if (event.data === 'bb-close') {
      // حالت بسته: سایز دکمه، کاملا گرد
      container.style.width = '60px';
      container.style.height = '600px'; // ارتفاع را کم نمیکنیم تا انیمیشن بسته شدن دیده شود (داخل iframe مخفی میشود)
      // صبر میکنیم تا انیمیشن بسته شدن تمام شود بعد کانتینر را کوچک میکنیم
      setTimeout(() => {
        container.style.height = '600px'; // نکته: ارتفاع را کم نکنیم بهتر است، فقط عرض
        // استراتژی بهتر: مخفی کردن کامل چت باکس و فقط نمایش دکمه
        // بیایید ساده تر کار کنیم:
        container.style.width = '60px';
        container.style.height = '60px';
        container.style.boxShadow = 'none';
        iframe.style.borderRadius = '30px';
      }, 50); // تاخیر بسیار کم
    }
  });

  // 4. محتوای HTML داخل Iframe
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="fa" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            * { box-sizing: border-box; }
            body {
                margin: 0; padding: 0;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                overflow: hidden;
                background: transparent;
            }

            /* دکمه شناور */
            #fab {
                position: absolute; bottom: 0; right: 0;
                width: 60px; height: 60px; border-radius: 50%;
                background: #4F46E5; color: white; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                transition: transform 0.2s;
                z-index: 200;
            }
            #fab:hover { transform: scale(1.05); }

            /* پنجره چت */
            #chat-window {
                position: absolute; bottom: 75px; right: 0; left: 0; top: 0;
                background: white;
                display: none; flex-direction: column;
                border-radius: 16px;
                overflow: hidden;
                border: 1px solid #e5e7eb;
            }

            /* هدر */
            #header {
                background: linear-gradient(to right, #4F46E5, #6366f1);
                padding: 15px; color: white; font-weight: bold;
                display: flex; justify-content: space-between; align-items: center;
                font-size: 14px;
                box-shadow: 0 2px 5px rgba(0,0,0,0.05);
            }

            /* پیام‌ها */
            #messages {
                flex: 1; overflow-y: auto; padding: 15px;
                display: flex; flex-direction: column; gap: 10px;
                background: #f9fafb;
            }
            .msg {
                max-width: 85%; padding: 10px 14px; border-radius: 12px;
                font-size: 13px; line-height: 1.5; word-wrap: break-word;
            }
            .msg-user { align-self: flex-end; background: #4F46E5; color: white; border-bottom-left-radius: 2px; }
            .msg-bot { align-self: flex-start; background: white; color: #374151; border: 1px solid #e5e7eb; border-bottom-right-radius: 2px; }

            /* بخش ورودی */
            #input-area {
                padding: 12px; border-top: 1px solid #eee; background: white;
                display: flex; gap: 8px; align-items: center;
            }

            /* فیکس مشکل تایپ */
            input {
                flex: 1;
                border: 1px solid #ddd;
                border-radius: 20px;
                padding: 12px 15px;
                outline: none;
                font-size: 14px;
                width: 100%;
            }
            input:focus { border-color: #4F46E5; }

            button.send-btn {
                background: #4F46E5; color: white; border: none;
                width: 40px; height: 40px; border-radius: 50%;
                cursor: pointer; display: flex; align-items: center; justify-content: center;
                font-size: 16px;
            }

            /* وضعیت باز/بسته */
            .open #chat-window { display: flex; }
            .open #fab svg.chat-icon { display: none; }
            .open #fab svg.close-icon { display: block; }
            svg.close-icon { display: none; }

            /* اسکرول بار زیبا */
            ::-webkit-scrollbar { width: 5px; }
            ::-webkit-scrollbar-track { background: transparent; }
            ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        </style>
    </head>
    <body>
        <div id="app">
            <div id="chat-window">
                <div id="header">
                    <span>پشتیبانی</span>
                    <span style="cursor:pointer; font-size:20px;" id="bb-close">×</span>
                </div>
                <div id="messages"></div>
                <div id="input-area">
                    <input type="text" id="msg-input" placeholder="پیام خود را بنویسید..." />
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
            const GUEST_ID = "${guestId}";

            const app = document.getElementById('app');
            const fab = document.getElementById('fab');
            const input = document.getElementById('msg-input');
            const msgsDiv = document.getElementById('messages');
            const btn = document.getElementById('send-btn');

            let isOpen = false;
            let socket;

            // باز و بسته کردن
            function toggle() {
                isOpen = !isOpen;
                if (isOpen) {
                    app.classList.add('open');
                    window.parent.postMessage('bb-open', '*');
                    // فوکوس اجباری با تاخیر
                    setTimeout(() => input.focus(), 300);
                } else {
                    app.classList.remove('open');
                    window.parent.postMessage('bb-close', '*');
                }
            }

            fab.onclick = toggle;
            document.getElementById('bb-close').onclick = toggle;

            // اتصال سوکت
            try {
                socket = io(SERVER_URL);
                socket.emit('join_room', "web_" + CHANNEL_ID + "_" + GUEST_ID);

                socket.on('new_message', (msg) => {
                    if(msg.direction === 'outgoing') addMsg(msg.content, 'bot');
                });
            } catch(e) {}

            function addMsg(text, sender) {
                if(!text) return;
                const d = document.createElement('div');
                d.className = "msg msg-" + sender;
                d.innerText = text;
                msgsDiv.appendChild(d);
                msgsDiv.scrollTop = msgsDiv.scrollHeight;
            }

            const send = () => {
                const txt = input.value.trim();
                if(!txt) return;
                addMsg(txt, 'user');
                input.value = '';
                input.focus(); // فوکوس مجدد

                fetch(SERVER_URL + '/api/channels/web/message', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ channelId: CHANNEL_ID, guestId: GUEST_ID, message: txt })
                });
            };

            btn.onclick = send;
            input.onkeypress = e => e.key === 'Enter' && send();

            // پیام خوش‌آمد
            setTimeout(() => {
                if(msgsDiv.children.length === 0) addMsg("سلام! چطور میتونم کمک کنم؟", 'bot');
            }, 500);

        </script>
    </body>
    </html>
    `;

  // Write to Iframe
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(htmlContent);
  doc.close();
})();
