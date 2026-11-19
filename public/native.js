/*
 * 原生通道封装（Capacitor 插件 RaccoonHttp）。
 *
 * WebView 里的 fetch 受跨域预检、UA、混合内容等一堆策略影响，聊天这种
 * 长连接 + 一堆自定义头的请求在真机上容易直接 "Failed to fetch"。
 * 这里换成系统网络栈发请求，响应按行推回来，既绕开限制又能保持流式。
 *
 * 不依赖 @capacitor/core 的 registerPlugin：原生桥本身就在 window.Capacitor 上
 * 暴露了 nativePromise / addListener，直接调即可，插件按名字寻址。
 * 非 App 环境时 available() 返回 false，调用方自动退回 fetch。
 */
(function (global) {
  'use strict';

  var PLUGIN = 'RaccoonHttp';
  var cached;

  function bridge() {
    if (cached !== undefined) return cached;
    var c = global.Capacitor;
    if (
      c &&
      typeof c.nativePromise === 'function' &&
      typeof c.addListener === 'function' &&
      typeof c.isNativePlatform === 'function' &&
      c.isNativePlatform()
    ) {
      cached = c;
    } else {
      cached = null;
    }
    return cached;
  }

  function available() {
    return !!bridge();
  }

  function uid() {
    var b = new Uint8Array(16);
    var c = global.crypto || global.msCrypto;
    if (c && c.getRandomValues) c.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var hx = '0123456789abcdef';
    var out = '';
    for (var j = 0; j < 16; j++) {
      if (j === 4 || j === 6 || j === 8 || j === 10) out += '-';
      out += hx[b[j] >> 4] + hx[b[j] & 0xf];
    }
    return out;
  }

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  /**
   * 流式请求。
   * opts: { url, method, headers, body, onLine(line), signal }
   * 返回 HTTP 状态码；连接层失败时抛错。
   */
  async function stream(opts) {
    var cap = bridge();
    if (!cap) throw new Error('原生通道不可用');

    var id = uid();
    var status = 0;
    var errorMsg = '';
    var ended = false;
    var aborted = false;

    var handle = cap.addListener(PLUGIN, 'ev', function (d) {
      if (!d || d.id !== id) return;
      if (d.type === 'head') {
        status = parseInt(d.status, 10) || 0;
      } else if (d.type === 'line') {
        try {
          opts.onLine(d.line);
        } catch (e) {}
      } else if (d.type === 'end') {
        status = parseInt(d.status, 10) || status;
        ended = true;
      } else if (d.type === 'error') {
        errorMsg = d.message || '连接中断';
        ended = true;
      }
    });

    if (opts.signal) {
      opts.signal.addEventListener('abort', function () {
        aborted = true;
        try {
          cap.nativePromise(PLUGIN, 'cancel', { id: id });
        } catch (e) {}
      });
    }

    // addListener 是异步投递的，给原生侧一点时间注册，避免漏掉第一行
    await sleep(60);

    var openErr = '';
    try {
      await cap.nativePromise(PLUGIN, 'open', {
        id: id,
        url: opts.url,
        method: opts.method || 'POST',
        headers: opts.headers || {},
        body: opts.body || '',
      });
    } catch (e) {
      openErr = (e && e.message) || '原生请求失败';
    }

    // 结束事件与 open() 的 resolve 先后不保证，等一小会儿
    var t0 = Date.now();
    while (!ended && Date.now() - t0 < 3000) await sleep(40);
    try {
      if (handle && handle.remove) await handle.remove();
    } catch (e) {}

    if (aborted) {
      var ae = new Error('已停止');
      ae.name = 'AbortError';
      throw ae;
    }
    if (!status) throw new Error(openErr || errorMsg || '原生请求失败');
    if (errorMsg) throw new Error(errorMsg);
    return status;
  }

  async function probe(url) {
    var cap = bridge();
    if (!cap) return null;
    try {
      var r = await cap.nativePromise(PLUGIN, 'probe', { url: url });
      return {
        ok: !!r.ok,
        status: parseInt(r.status, 10) || 0,
        ms: parseInt(r.ms, 10) || 0,
        message: r.message || '',
      };
    } catch (e) {
      return { ok: false, status: 0, ms: 0, message: (e && e.message) || '原生探测失败' };
    }
  }

  global.RaccoonNative = {
    available: available,
    stream: stream,
    probe: probe,
  };
})(typeof window !== 'undefined' ? window : globalThis);
