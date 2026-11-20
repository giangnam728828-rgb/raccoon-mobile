package com.raccoon.mobile;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.Log;
import android.view.accessibility.AccessibilityNodeInfo;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 设备操作插件：读屏 / 点击 / 手势 / 全局按键 / 输入。
 *
 * 依赖 RaccoonA11yService（无障碍服务）。服务未开启时所有方法都返回明确错误，
 * 由前端提示用户去系统设置开启，不静默失败。
 */
@CapacitorPlugin(name = "RaccoonDevice")
public class RaccoonDevicePlugin extends Plugin {

    private static final String TAG = "RaccoonDevice";

    static RaccoonA11yService service;

    static void attach(RaccoonA11yService s) {
        service = s;
    }

    static void detach() {
        service = null;
    }

    private AccessibilityService svc() {
        return service;
    }

    private void failNoService(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ok", false);
        ret.put("code", "NO_SERVICE");
        ret.put("message", "无障碍服务未开启，请到系统设置 → 无障碍里打开「小浣熊」");
        call.resolve(ret);
    }

    /** 服务是否可用 */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("service", svc() != null);
        call.resolve(ret);
    }

    /** 打开系统无障碍设置页 */
    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("打开设置失败：" + e.getMessage());
        }
    }

    /** 读取当前窗口节点树 */
    @PluginMethod
    public void dump(PluginCall call) {
        AccessibilityService s = svc();
        if (s == null) return failNoService(call);

        try {
            AccessibilityNodeInfo root = s.getRootInActiveWindow();
            if (root == null) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("message", "读不到当前窗口（可能正处于安全界面）");
                call.resolve(ret);
                return;
            }
            JSONObject win = new JSONObject();
            win.put("pkg", safe(root.getPackageName()));
            win.put("windowId", root.getWindowId());
            win.put("ts", System.currentTimeMillis());

            JSONArray nodes = new JSONArray();
            collect(root, nodes, 0);

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("pkg", safe(root.getPackageName()));
            ret.put("windowId", root.getWindowId());
            ret.put("nodes", nodes);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "dump failed", e);
            call.reject("读取失败：" + e.getMessage());
        }
    }

    private void collect(AccessibilityNodeInfo node, JSONArray out, int depth) {
        if (node == null || depth > 28 || out.length() > 800) return;
        try {
            JSONObject o = new JSONObject();
            o.put("text", safe(node.getText()));
            o.put("desc", safe(node.getContentDescription()));
            o.put("cls", shortCls(safe(node.getClassName())));
            o.put("clickable", node.isClickable());
            o.put("editable", node.isEditable());
            o.put("scrollable", node.isScrollable());
            o.put("enabled", node.isEnabled());
            o.put("visible", node.isVisibleToUser());
            String vid = node.getViewIdResourceName();
            if (vid != null) o.put("id", vid);
            android.graphics.Rect r = new android.graphics.Rect();
            node.getBoundsInScreen(r);
            if (!r.isEmpty()) {
                o.put("bounds", new JSONArray()
                        .put(r.left).put(r.top).put(r.right).put(r.bottom));
                o.put("cx", r.centerX());
                o.put("cy", r.centerY());
            }
            out.put(o);
            for (int i = 0; i < node.getChildCount(); i++) {
                collect(node.getChild(i), out, depth + 1);
            }
        } catch (Exception ignored) {
        }
    }

    private String shortCls(String full) {
        if (full == null) return "";
        int i = full.lastIndexOf('.');
        return i >= 0 ? full.substring(i + 1) : full;
    }

    private String safe(CharSequence cs) {
        return cs == null ? "" : cs.toString();
    }

    /** 按文字/描述查找并点击 */
    @PluginMethod
    public void tapByText(PluginCall call) {
        AccessibilityService s = svc();
        if (s == null) return failNoService(call);

        String q = call.getString("text", "");
        if (TextUtils.isEmpty(q)) {
            call.reject("缺少 text");
            return;
        }
        try {
            AccessibilityNodeInfo root = s.getRootInActiveWindow();
            if (root == null) {
                call.reject("读不到当前窗口");
                return;
            }
            List<AccessibilityNodeInfo> all = new ArrayList<>();
            collectAll(root, all);
            for (AccessibilityNodeInfo n : all) {
                String txt = safe(n.getText());
                String desc = safe(n.getContentDescription());
                if (txt.contains(q) || desc.contains(q)) {
                    if (clickSelfOrParent(n)) {
                        JSObject ret = new JSObject();
                        ret.put("ok", true);
                        ret.put("hit", txt.isEmpty() ? desc : txt);
                        call.resolve(ret);
                        return;
                    }
                }
            }
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("message", "没找到含「" + q + "」的可点击元素");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("查找失败：" + e.getMessage());
        }
    }

    private void collectAll(AccessibilityNodeInfo node, List<AccessibilityNodeInfo> out) {
        if (node == null || out.size() > 800) return;
        out.add(node);
        for (int i = 0; i < node.getChildCount(); i++) collectAll(node.getChild(i), out);
    }

    private boolean clickSelfOrParent(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo n = node;
        for (int i = 0; i < 6 && n != null; i++) {
            if (n.isClickable() && n.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true;
            n = n.getParent();
        }
        return false;
    }

    /** 按坐标点击 */
    @PluginMethod
    public void tap(PluginCall call) {
        AccessibilityService s = svc();
        if (s == null) return failNoService(call);

        int x = call.getInt("x", -1);
        int y = call.getInt("y", -1);
        if (x < 0 || y < 0) {
            call.reject("缺少有效坐标");
            return;
        }
        try {
            android.graphics.Path path = new android.graphics.Path();
            path.moveTo(x, y);
            android.accessibilityservice.GestureDescription.StrokeDescription stroke =
                    new android.accessibilityservice.GestureDescription.StrokeDescription(path, 0, 60);
            android.accessibilityservice.GestureDescription gd =
                    new android.accessibilityservice.GestureDescription.Builder().addStroke(stroke).build();
            s.dispatchGesture(gd, null, null);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("点击失败：" + e.getMessage());
        }
    }

    /** 滑动 */
    @PluginMethod
    public void swipe(PluginCall call) {
        AccessibilityService s = svc();
        if (s == null) return failNoService(call);

        int x1 = call.getInt("x1", -1);
        int y1 = call.getInt("y1", -1);
        int x2 = call.getInt("x2", -1);
        int y2 = call.getInt("y2", -1);
        int ms = Math.max(80, Math.min(2000, call.getInt("ms", 300)));
        if (x1 < 0 || y1 < 0 || x2 < 0 || y2 < 0) {
            call.reject("缺少有效坐标");
            return;
        }
        try {
            android.graphics.Path path = new android.graphics.Path();
            path.moveTo(x1, y1);
            path.lineTo(x2, y2);
            android.accessibilityservice.GestureDescription.StrokeDescription stroke =
                    new android.accessibilityservice.GestureDescription.StrokeDescription(path, 0, ms);
            android.accessibilityservice.GestureDescription gd =
                    new android.accessibilityservice.GestureDescription.Builder().addStroke(stroke).build();
            s.dispatchGesture(gd, null, null);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("滑动失败：" + e.getMessage());
        }
    }

    /** 全局按键：back / home / recents / notifications */
    @PluginMethod
    public void global(PluginCall call) {
        AccessibilityService s = svc();
        if (s == null) return failNoService(call);

        String a = call.getString("action", "");
        int code;
        switch (a) {
            case "back": code = AccessibilityService.GLOBAL_ACTION_BACK; break;
            case "home": code = AccessibilityService.GLOBAL_ACTION_HOME; break;
            case "recents": code = AccessibilityService.GLOBAL_ACTION_RECENTS; break;
            case "notifications": code = AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS; break;
            case "quicksettings": code = AccessibilityService.GLOBAL_ACTION_QUICK_SETTINGS; break;
            case "lock": code = AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN; break;
            default:
                call.reject("未知操作：" + a);
                return;
        }
        boolean ok = s.performGlobalAction(code);
        JSObject ret = new JSObject();
        ret.put("ok", ok);
        call.resolve(ret);
    }

    /** 向当前焦点输入框写入文字 */
    @PluginMethod
    public void setText(PluginCall call) {
        AccessibilityService s = svc();
        if (s == null) return failNoService(call);

        String text = call.getString("text", "");
        try {
            AccessibilityNodeInfo root = s.getRootInActiveWindow();
            if (root == null) {
                call.reject("读不到当前窗口");
                return;
            }
            AccessibilityNodeInfo focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
            if (focused == null) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("message", "当前没有聚焦的输入框");
                call.resolve(ret);
                return;
            }
            android.os.Bundle args = new android.os.Bundle();
            args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
            boolean ok = focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
            JSObject ret = new JSObject();
            ret.put("ok", ok);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("输入失败：" + e.getMessage());
        }
    }
}
