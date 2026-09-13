package com.xiaopeng.layouts;

import com.intellij.ide.util.PropertiesComponent;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.JDOMUtil;
import com.intellij.openapi.wm.ex.ToolWindowManagerEx;
import com.intellij.openapi.wm.impl.DesktopLayout;
import org.jdom.Element;
import org.jetbrains.annotations.NotNull;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** 布局存取：保存 / 列举 / 应用 / 删除（应用级持久化；值为 DesktopLayout 序列化 XML） */
public final class LayoutStore {

    private static final String NAMES_KEY = "xpLayoutManager.names";
    private static final String PREFIX = "xpLayoutManager.layout.";

    private LayoutStore() {
    }

    private static PropertiesComponent props() {
        return PropertiesComponent.getInstance();
    }

    private static List<String> rawNames() {
        try {
            List<String> list = props().getList(NAMES_KEY);
            return list == null ? new ArrayList<>() : new ArrayList<>(list);
        } catch (Throwable t) {
            return new ArrayList<>();
        }
    }

    public static @NotNull List<String> names() {
        List<String> out = rawNames();
        Collections.sort(out);
        return out;
    }

    /** 保存当前工具窗布局为命名预设 */
    public static void save(String name, @NotNull Project project) throws Exception {
        DesktopLayout layout = ToolWindowManagerEx.getInstanceEx(project).getLayout();
        Element el = layout.writeExternal("user");
        props().setValue(PREFIX + name, JDOMUtil.writeElement(el));
        List<String> list = rawNames();
        if (!list.contains(name)) {
            list.add(name);
            props().setList(NAMES_KEY, list);
        }
    }

    /** 应用命名布局 */
    public static void apply(String name, @NotNull Project project) throws Exception {
        String xml = props().getValue(PREFIX + name);
        if (xml == null) {
            return;
        }
        Element el = JDOMUtil.load(xml);
        DesktopLayout dl = new DesktopLayout();
        dl.readExternal(el, false);
        ToolWindowManagerEx.getInstanceEx(project).setLayout(dl);
    }

    public static void remove(String name) {
        props().unsetValue(PREFIX + name);
        List<String> list = rawNames();
        list.remove(name);
        props().setList(NAMES_KEY, list);
    }
}
