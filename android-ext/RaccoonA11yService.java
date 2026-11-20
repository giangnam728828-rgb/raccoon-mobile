package com.raccoon.mobile;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;

/**
 * 小浣熊无障碍服务：为 RaccoonDevicePlugin 提供读屏与手势能力。
 *
 * 只做「读节点 + 执行手势」，不后台偷跑：服务连接后把自身交给插件，
 * 断开时解除引用，前端据此显示「已就绪 / 未开启」。
 */
public class RaccoonA11yService extends AccessibilityService {

    private static final String TAG = "RaccoonA11y";

    @Override
    public void onServiceConnected() {
        super.onServiceConnected();
        try {
            AccessibilityServiceInfo info = getServiceInfo();
            if (info != null) {
                info.eventTypes = AccessibilityEvent.TYPES_ALL_MASK;
                info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
                info.flags |= AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
                        | AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
                info.notificationTimeout = 60;
                setServiceInfo(info);
            }
        } catch (Exception e) {
            Log.w(TAG, "setServiceInfo failed", e);
        }

        RaccoonDevicePlugin.attach(this);
        Log.i(TAG, "无障碍服务已连接");
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // 不消费事件，只保证服务在线
    }

    @Override
    public void onInterrupt() {
        // 系统要求实现，无需处理
    }

    @Override
    public boolean onUnbind(android.content.Intent intent) {
        RaccoonDevicePlugin.detach();
        Log.i(TAG, "无障碍服务已断开");
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        RaccoonDevicePlugin.detach();
        super.onDestroy();
    }
}
