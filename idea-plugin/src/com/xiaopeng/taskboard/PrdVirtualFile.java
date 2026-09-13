package com.xiaopeng.taskboard;

import com.intellij.openapi.fileTypes.PlainTextFileType;
import com.intellij.testFramework.LightVirtualFile;

/** PRD 虚拟文件：承载飞书文档 URL，由 PrdFileEditorProvider 以 JCEF 编辑器打开 */
public class PrdVirtualFile extends LightVirtualFile {

    private final String url;

    public PrdVirtualFile(String url, String name) {
        super(name, PlainTextFileType.INSTANCE, "");
        this.url = url;
    }

    public String getUrl() {
        return url;
    }
}
