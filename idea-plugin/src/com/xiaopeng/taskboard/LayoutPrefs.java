package com.xiaopeng.taskboard;

import com.intellij.ide.util.PropertiesComponent;

/** 对照布局的比例偏好（应用级持久化）：diff 宽度比例 / TaskBoard 高度比例 */
public final class LayoutPrefs {

    private static final String KEY_DIFF_RATIO = "taskboard.layout.diffRatio";
    private static final String KEY_TOOL_WINDOW_RATIO = "taskboard.layout.toolWindowRatio";

    public static final float DEFAULT_DIFF_RATIO = 0.50f;
    public static final float DEFAULT_TOOL_WINDOW_RATIO = 0.30f;

    private LayoutPrefs() {
    }

    public static float diffRatio() {
        try {
            return clamp(PropertiesComponent.getInstance().getFloat(KEY_DIFF_RATIO, DEFAULT_DIFF_RATIO), 0.3f, 0.85f);
        } catch (Throwable t) {
            return DEFAULT_DIFF_RATIO;
        }
    }

    public static void setDiffRatio(float v) {
        try {
            PropertiesComponent.getInstance().setValue(KEY_DIFF_RATIO, clamp(v, 0.3f, 0.85f), DEFAULT_DIFF_RATIO);
        } catch (Throwable ignore) {
            // 忽略
        }
    }

    public static float toolWindowRatio() {
        try {
            return clamp(PropertiesComponent.getInstance()
                    .getFloat(KEY_TOOL_WINDOW_RATIO, DEFAULT_TOOL_WINDOW_RATIO), 0.15f, 0.5f);
        } catch (Throwable t) {
            return DEFAULT_TOOL_WINDOW_RATIO;
        }
    }

    public static void setToolWindowRatio(float v) {
        try {
            PropertiesComponent.getInstance().setValue(KEY_TOOL_WINDOW_RATIO, clamp(v, 0.15f, 0.5f), DEFAULT_TOOL_WINDOW_RATIO);
        } catch (Throwable ignore) {
            // 忽略
        }
    }

    private static float clamp(float v, float min, float max) {
        return Math.max(min, Math.min(max, v));
    }
}
