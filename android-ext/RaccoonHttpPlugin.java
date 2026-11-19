package com.raccoon.mobile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 原生 HTTP 流式通道。
 *
 * WebView 里的 fetch 受 CORS、预检、UA 等一堆策略影响，聊天接口在真机上会时不时
 * 直接抛 "Failed to fetch"。这个插件用系统网络栈发请求，把响应按行推回 JS，
 * 既绕开浏览器的跨域限制，又能保持流式输出的手感。
 *
 * 事件统一走 "ev"，payload: { id, type: head|line|end|error, ... }
 */
@CapacitorPlugin(name = "RaccoonHttp")
public class RaccoonHttpPlugin extends Plugin {

    private final Map<String, HttpURLConnection> live = new ConcurrentHashMap<>();

    @PluginMethod
    public void open(final PluginCall call) {
        final String id = call.getString("id", "");
        final String url = call.getString("url", "");
        final String method = call.getString("method", "POST");
        final String body = call.getString("body", "");
        final JSObject headers = call.getObject("headers");

        if (url == null || url.isEmpty()) {
            call.reject("url 不能为空");
            return;
        }
        if (id == null || id.isEmpty()) {
            call.reject("id 不能为空");
            return;
        }

        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection conn = null;
                try {
                    conn = (HttpURLConnection) new URL(url).openConnection();
                    conn.setRequestMethod(method == null ? "POST" : method);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(180000);
                    conn.setInstanceFollowRedirects(true);
                    conn.setDoInput(true);

                    if (headers != null) {
                        Iterator<String> keys = headers.keys();
                        while (keys.hasNext()) {
                            String k = keys.next();
                            String v = headers.optString(k, "");
                            if (v != null && !v.isEmpty()) {
                                conn.setRequestProperty(k, v);
                            }
                        }
                    }

                    if (body != null && !body.isEmpty() && !"GET".equalsIgnoreCase(method)) {
                        conn.setDoOutput(true);
                        byte[] payload = body.getBytes(StandardCharsets.UTF_8);
                        conn.setFixedLengthStreamingMode(payload.length);
                        OutputStream os = conn.getOutputStream();
                        os.write(payload);
                        os.flush();
                        os.close();
                    }

                    live.put(id, conn);

                    int code = conn.getResponseCode();
                    emit(id, "head", "status", String.valueOf(code));

                    InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
                    if (is != null) {
                        BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
                        String line;
                        while ((line = br.readLine()) != null) {
                            emit(id, "line", "line", line);
                        }
                        br.close();
                    }

                    emit(id, "end", "status", String.valueOf(code));
                    call.resolve();
                } catch (Exception e) {
                    String msg = e.getClass().getSimpleName();
                    if (e.getMessage() != null) msg = msg + ": " + e.getMessage();
                    emit(id, "error", "message", msg);
                    call.reject(msg);
                } finally {
                    live.remove(id);
                    if (conn != null) {
                        try {
                            conn.disconnect();
                        } catch (Exception ignored) {
                        }
                    }
                }
            }
        }).start();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id", "");
        HttpURLConnection c = id == null ? null : live.get(id);
        if (c != null) {
            try {
                c.disconnect();
            } catch (Exception ignored) {
            }
            live.remove(id);
        }
        call.resolve();
    }

    /** 连通性探测：只关心能不能拿到响应 */
    @PluginMethod
    public void probe(PluginCall call) {
        final String url = call.getString("url", "");
        if (url == null || url.isEmpty()) {
            call.reject("url 不能为空");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection conn = null;
                long started = System.currentTimeMillis();
                try {
                    conn = (HttpURLConnection) new URL(url).openConnection();
                    conn.setRequestMethod("GET");
                    conn.setConnectTimeout(8000);
                    conn.setReadTimeout(8000);
                    int code = conn.getResponseCode();
                    JSObject ret = new JSObject();
                    ret.put("ok", true);
                    ret.put("status", String.valueOf(code));
                    ret.put("ms", String.valueOf(System.currentTimeMillis() - started));
                    call.resolve(ret);
                } catch (Exception e) {
                    JSObject ret = new JSObject();
                    ret.put("ok", false);
                    ret.put("message", e.getClass().getSimpleName());
                    ret.put("ms", String.valueOf(System.currentTimeMillis() - started));
                    call.resolve(ret);
                } finally {
                    if (conn != null) {
                        try {
                            conn.disconnect();
                        } catch (Exception ignored) {
                        }
                    }
                }
            }
        }).start();
    }

    private void emit(String id, String type, String key, Object value) {
        JSObject ev = new JSObject();
        ev.put("id", id);
        ev.put("type", type);
        ev.put(key, value);
        notifyListeners("ev", ev);
    }
}
