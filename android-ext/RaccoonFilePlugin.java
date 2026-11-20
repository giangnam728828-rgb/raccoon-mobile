package com.raccoon.mobile;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResultCallback;
import androidx.core.app.ActivityCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.ActivityCallback;

import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * 文件系统插件：目录列表、文件读取/写入、媒体扫描
 */
@CapacitorPlugin(
    name = "RaccoonFile",
    permissions = {
        @Permission(strings = {Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE}, alias = "filesystem")
    }
)
public class RaccoonFilePlugin extends Plugin {

    private static final String ROOT_DIR = "Documents/Raccoon";
    private File rootDir;

    @Override
    public void load() {
        super.load();
        // 初始化根目录（沙箱）
        try {
            rootDir = new File(getBridge().getContext().getFilesDir(), ROOT_DIR);
            if (!rootDir.exists()) {
                rootDir.mkdirs();
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @PluginMethod
    public void list(PluginCall call) {
        String dirPath = call.getString("path", "");
        File dir = resolvePath(dirPath);
        
        if (dir == null || !dir.exists() || !dir.isDirectory()) {
            call.reject("无效路径或目录不存在");
            return;
        }

        JSArray result = new JSArray();
        File[] files = dir.listFiles();
        if (files != null) {
            for (File f : files) {
                JSObject entry = new JSObject();
                entry.put("name", f.getName());
                entry.put("isDir", f.isDirectory());
                entry.put("size", f.isDirectory() ? 0 : f.length());
                entry.put("modified", f.lastModified());
                entry.put("path", relativePath(f));
                result.add(entry);
            }
        }
        
        // 排序：文件夹优先，然后按名称
        ArrayList<JSObject> sorted = new ArrayList<>();
        ArrayList<JSObject> others = new ArrayList<>();
        for (int i = 0; i < result.length(); i++) {
            try {
                JSObject o = result.get(i);
                if (o.getBoolean("isDir")) sorted.add(o);
                else others.add(o);
            } catch (Exception ignored) {}
        }
        sorted.sort((a, b) -> a.optString("name").compareTo(b.optString("name")));
        others.sort((a, b) -> a.optString("name").compareTo(b.optString("name")));
        
        JSArray finalResult = new JSArray();
        for (JSObject o : sorted) finalResult.add(o);
        for (JSObject o : others) finalResult.add(o);
        
        call.resolve(finalResult);
    }

    @PluginMethod
    public void read(PluginCall call) {
        String filePath = call.getString("path", "");
        File file = resolvePath(filePath);
        
        if (file == null || !file.exists() || file.isDirectory()) {
            call.reject("文件不存在或为目录");
            return;
        }

        try {
            byte[] bytes = new byte[(int) file.length()];
            java.io.FileInputStream fis = new java.io.FileInputStream(file);
            fis.read(bytes);
            fis.close();
            
            // Base64 编码返回
            String base64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);
            call.success(base64);
        } catch (Exception e) {
            call.reject("读取失败：" + e.getMessage());
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        String filePath = call.getString("path", "");
        String content = call.getString("content", "");
        
        File file = resolvePath(filePath);
        if (file == null) {
            call.reject("无效路径");
            return;
        }

        try {
            File parent = file.getParentFile();
            if (parent != null && !parent.exists()) {
                parent.mkdirs();
            }
            
            java.io.FileOutputStream fos = new java.io.FileOutputStream(file);
            fos.write(content.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            fos.close();
            
            JSObject ret = new JSObject();
            ret.put("path", filePath);
            call.success(ret);
        } catch (Exception e) {
            call.reject("写入失败：" + e.getMessage());
        }
    }

    @PluginMethod
    public void delete(PluginCall call) {
        String filePath = call.getString("path", "");
        File file = resolvePath(filePath);
        
        if (file == null || !file.exists()) {
            call.reject("文件/目录不存在");
            return;
        }

        try {
            deleteRecursively(file);
            call.success();
        } catch (Exception e) {
            call.reject("删除失败：" + e.getMessage());
        }
    }

    @PluginMethod
    public void mkdir(PluginCall call) {
        String dirPath = call.getString("path", "");
        File dir = resolvePath(dirPath);
        
        if (dir == null) {
            call.reject("无效路径");
            return;
        }

        try {
            if (!dir.exists()) {
                dir.mkdirs();
            }
            JSObject ret = new JSObject();
            ret.put("path", dirPath);
            call.success(ret);
        } catch (Exception e) {
            call.reject("创建失败：" + e.getMessage());
        }
    }

    @PluginMethod
    public void rename(PluginCall call) {
        String fromPath = call.getString("from", "");
        String toPath = call.getString("to", "");
        
        File from = resolvePath(fromPath);
        File to = resolvePath(toPath);
        
        if (from == null || !from.exists()) {
            call.reject("源文件不存在");
            return;
        }
        if (to == null) {
            call.reject("目标路径无效");
            return;
        }

        try {
            boolean renamed = from.renameTo(to);
            if (renamed) {
                JSObject ret = new JSObject();
                ret.put("path", toPath);
                call.success(ret);
            } else {
                call.reject("重命名失败");
            }
        } catch (Exception e) {
            call.reject("重命名失败：" + e.getMessage());
        }
    }

    @PluginMethod
    public void pickFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        
        startActivityForResult(call, intent, "filePickerResult");
    }

    @ActivityCallback
    private void filePickerResult(PluginCall call) {
        Uri uri = call.getData().getData();
        if (uri == null) {
            call.reject("未选择文件");
            return;
        }

        try {
            // 复制到沙箱目录
            String fileName = getFileName(uri);
            File dest = new File(rootDir, fileName);
            
            java.io.InputStream in = getContext().getContentResolver().openInputStream(uri);
            java.io.OutputStream out = new java.io.FileOutputStream(dest);
            
            byte[] buffer = new byte[8192];
            int len;
            while ((len = in.read(buffer)) > 0) {
                out.write(buffer, 0, len);
            }
            
            in.close();
            out.close();
            
            JSObject ret = new JSObject();
            ret.put("path", relativePath(dest));
            ret.put("name", fileName);
            call.success(ret);
        } catch (Exception e) {
            call.reject("上传失败：" + e.getMessage());
        }
    }

    private File resolvePath(String path) {
        if (path == null || path.isEmpty()) return rootDir;
        
        // 安全校验：路径必须在 rootDir 内
        File resolved = new File(rootDir, path.replace("/", File.separator));
        try {
            String realPath = resolved.getCanonicalPath();
            String rootRealPath = rootDir.getCanonicalPath();
            
            if (!realPath.startsWith(rootRealPath + File.separator) && !realPath.equals(rootRealPath)) {
                return null; // 路径超出安全范围
            }
            return resolved;
        } catch (Exception e) {
            return null;
        }
    }

    private String relativePath(File file) {
        try {
            String realPath = file.getCanonicalPath();
            String rootRealPath = rootDir.getCanonicalPath();
            return realPath.substring(rootRealPath.length() + 1);
        } catch (Exception e) {
            return file.getName();
        }
    }

    private void deleteRecursively(File file) throws Exception {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursively(child);
                }
            }
        }
        if (!file.delete()) {
            throw new Exception("无法删除：" + file.getPath());
        }
    }

    private String getFileName(Uri uri) {
        String result = null;
        if (uri.getScheme().equals("content")) {
            android.content.CursorLoader loader = new android.content.CursorLoader(
                getContext(), uri, null, null, null, null
            );
            android.support.v4.content.CursorLoader cLoader = (android.support.v4.content.CursorLoader) loader;
            android.database.Cursor cursor = cLoader.loadInBackground();
            if (cursor != null) {
                int idx = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    cursor.moveToFirst();
                    result = cursor.getString(idx);
                }
                cursor.close();
            }
        }
        if (result == null) {
            result = uri.getPath();
            int cut = result.lastIndexOf('/');
            if (cut != -1) {
                result = result.substring(cut + 1);
            }
        }
        return result;
    }
}
