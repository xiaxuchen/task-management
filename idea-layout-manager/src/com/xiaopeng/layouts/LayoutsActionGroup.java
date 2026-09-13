package com.xiaopeng.layouts;

import com.intellij.openapi.actionSystem.ActionGroup;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.Separator;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.util.ArrayList;
import java.util.List;

/** Window 菜单下的「布局管理」动态菜单：保存 / 管理 / 已保存布局列表（点击应用） */
public class LayoutsActionGroup extends ActionGroup {

    public LayoutsActionGroup() {
        super("布局管理", true);
    }

    @Override
    public AnAction @NotNull [] getChildren(@Nullable AnActionEvent e) {
        List<AnAction> list = new ArrayList<>();
        list.add(new SaveLayoutAction());
        list.add(new ManageLayoutsAction());
        List<String> names = LayoutStore.names();
        if (!names.isEmpty()) {
            list.add(Separator.getInstance());
            for (String name : names) {
                list.add(new ApplyLayoutAction(name));
            }
        }
        return list.toArray(new AnAction[0]);
    }
}
