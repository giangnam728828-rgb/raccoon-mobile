package com.raccoon.mobile;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * 原生文件读写插件。
 *
 * 所有文件都限制在沙箱根目录内：getFilesDir()/Documents/Raccoon。
 * 任何解析后不在根目录内的路径一律拒绝，防止 ../ 越界。
 *
 * 对外方法（Capacitor 6）：
 *   list(path)              列出目录
 *   read(path[, encoding])  读取文件：encoding=utf8(默认) 或 base64
 *   write(path, content)    写入文件（content 为文本）
 *   writeBase64(path, data) 写入 Base64 内容
 *   delete(path)            删除文件/目录
 *   mkdir(path)             创建目录
 *   rename(from, to)        重命名
 *   pickFile()              SAF 选择文件并复制到沙箱
 *
 * 返回结构统一为 JSObject，失败时 resolve({ok:false, message})；
 * 参数非法时才 reject，避免前端 Promise 直接抛异常。
 */
@CapacitorPlugin(name = "RaccoonFile")
public class RaccoonFilePlugin extends Plugin {

    private static final String ROOT_DIR = "Documents/Raccoon";
    private File rootDir;

    @Override
    public void load() {
        super.load();
        try {
            rootDir = new File(getContext().getFilesDir(), ROOT_DIR);
            if (!rootDir.exists()) {
                rootDir.mkdirs();
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    /** ------------------- list ------------------- */

    @PluginMethod
    public void list(PluginCall call) {
        String dirPath = call.getString("path", "");
        File dir = resolvePath(dirPath);

        if (dir == null || !dir.exists() || !dir.isDirectory()) {
            fail(call, "无效路径或目录不存在");
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
                result.put(entry);
            }
        }

        // 排序：目录优先，其次按名称
        List<JSObject> dirs = new ArrayList<>();
        List<JSObject> others = new ArrayList<>();
        for (int i = 0; i < result.length(); i++) {
            try {
                JSObject o = result.getJSONObject(i);
                if (o.optBoolean("isDir")) dirs.add(o);
                else others.add(o);
            } catch (Exception ignored) {}
        }
        dirs.sort((a, b) -> a.optString("name").compareTo(b.optString("name")));
        others.sort((a, b) -> a.optString("name").compareTo(b.optString("name")));

        JSArray sorted = new JSArray();
        for (JSObject o : dirs) sorted.put(o);
        for (JSObject o : others) sorted.put(o);

        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("files", sorted);
        call.resolve(ret);
    }

    /** ------------------- read ------------------- */

    @PluginMethod
    public void read(PluginCall call) {
        String filePath = call.getString("path", "");
        String encoding = call.getString("encoding", "utf8"); // utf8 | base64
        File file = resolvePath(filePath);

        if (file == null || !file.exists() || file.isDirectory()) {
            fail(call, "文件不存在或为目录");
            return;
        }

        try {
            byte[] bytes = readAll(file);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("size", bytes.length);
            if ("base64".equalsIgnoreCase(encoding)) {
                ret.put("encoding", "base64");
                ret.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            } else {
                ret.put("encoding", "utf8");
                ret.put("data", new String(bytes, StandardCharsets.UTF_8));
            }
            ret.put("path", relativePath(file));
            call.resolve(ret);
        } catch (Exception e) {
            fail(call, "读取失败：" + e.getMessage());
        }
    }

    /** ------------------- write ------------------- */

    @PluginMethod
    public void write(PluginCall call) {
        String filePath = call.getString("path", "");
        String content = call.getString("content", "");
        File file = resolvePath(filePath);

        if (file == null) {
            fail(call, "无效路径");
            return;
        }
        if (content == null) content = "";

        try {
            File parent = file.getParentFile();
            if (parent != null && !parent.exists()) {
                parent.mkdirs();
            }
            byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
            writeAll(file, bytes);

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("path", relativePath(file));
            ret.put("size", bytes.length);
            call.resolve(ret);
        } catch (Exception e) {
            fail(call, "写入失败：" + e.getMessage());
        }
    }

    /** 写入 Base64 内容（二进制安全） */
    @PluginMethod
    public void writeBase64(PluginCall call) {
        String filePath = call.getString("path", "");
        String data = call.getString("data", "");
        File file = resolvePath(filePath);

        if (file == null) {
            fail(call, "无效路径");
            return;
        }

        try {
            File parent = file.getParentFile();
            if (parent != null && !parent.exists()) {
                parent.mkdirs();
            }
            byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
            writeAll(file, bytes);

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("path", relativePath(file));
            ret.put("size", bytes.length);
            call.resolve(ret);
        } catch (Exception e) {
            fail(call, "写入失败：" + e.getMessage());
        }
    }

    /** ------------------- delete ------------------- */

    @PluginMethod
    public void delete(PluginCall call) {
        String filePath = call.getString("path", "");
        File file = resolvePath(filePath);

        if (file == null || !file.exists()) {
            fail(call, "文件/目录不存在");
            return;
        }

        try {
            deleteRecursively(file);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("path", relativePath(file));
            call.resolve(ret);
        } catch (Exception e) {
            fail(call, "删除失败：" + e.getMessage());
        }
    }

    /** ------------------- mkdir ------------------- */

    @PluginMethod
    public void mkdir(PluginCall call) {
        String dirPath = call.getString("path", "");
        File dir = resolvePath(dirPath);

        if (dir == null) {
            fail(call, "无效路径");
            return;
        }

        try {
            if (!dir.exists() && !dir.mkdirs()) {
                fail(call, "创建目录失败");
                return;
            }
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("path", relativePath(dir));
            call.resolve(ret);
        } catch (Exception e) {
            fail(call, "创建失败：" + e.getMessage());
        }
    }

    /** ------------------- rename ------------------- */

    @PluginMethod
    public void rename(PluginCall call) {
        String fromPath = call.getString("from", "");
        String toPath = call.getString("to", "");

        File from = resolvePath(fromPath);
        File to = resolvePath(toPath);

        if (from == null || to == null) {
            fail(call, "无效路径");
            return;
        }
        if (!from.exists()) {
            fail(call, "源文件不存在");
            return;
        }

        try {
            File parent = to.getParentFile();
            if (parent != null && !parent.exists()) {
                parent.mkdirs();
            }
            if (!from.renameTo(to)) {
                fail(call, "重命名失败");
                return;
            }
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("from", relativePath(from));
            ret.put("to", relativePath(to));
            call.resolve(ret);
        } catch (Exception e) {
            fail(call, "重命名失败：" + e.getMessage());
        }
    }

    /** ------------------- pickFile ------------------- */

    @PluginMethod
    public void pickFile(PluginCall call) {
        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
            // 允许长期持有 URI 权限，便于后续再次读取
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            startActivityForResult(call, intent, "filePickerResult");
        } catch (Exception e) {
            fail(call, "无法打开文件选择器：" + e.getMessage());
        }
    }

    @ActivityCallback
    private void filePickerResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK) {
            fail(call, "未选择文件");
            return;
        }

        Intent data = result.getData();
        Uri uri = data != null ? data.getData() : null;
        if (uri == null) {
            fail(call, "未选择文件");
            return;
        }

        try {
            String fileName = getDisplayName(uri);
            if (fileName == null || fileName.isEmpty() || ".".equals(fileName) || "..".equals(fileName)) {
                fileName = "picked_" + System.currentTimeMillis();
            }
            // 避免覆盖同名文件
            File dest = new File(rootDir, fileName);
            String base = fileName;
            int dot = base.lastIndexOf('.');
            String namePart = dot > 0 ? base.substring(0, dot) : base;
            String extPart = dot > 0 ? base.substring(dot) : "";
            int counter = 1;
            while (dest.exists()) {
                dest = new File(rootDir, namePart + "_" + counter + extPart);
                counter++;
            }

            InputStream in = getContext().getContentResolver().openInputStream(uri);
            if (in == null) {
                fail(call, "无法读取所选文件");
                return;
            }
            try (OutputStream out = new FileOutputStream(dest)) {
                byte[] buffer = new byte[8192];
                int len;
                while ((len = in.read(buffer)) > 0) {
                    out.write(buffer, 0, len);
                }
                out.flush();
            } finally {
                in.close();
            }

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("path", relativePath(dest));
            ret.put("name", dest.getName());
            ret.put("size", dest.length());
            call.resolve(ret);
        } catch (Exception e) {
            fail(call, "导入文件失败：" + e.getMessage());
        }
    }

    /** ------------------- helpers ------------------- */

    private void fail(PluginCall call, String message) {
        JSObject ret = new JSObject();
        ret.put("ok", false);
        ret.put("message", message);
        call.resolve(ret);
    }

    /** 所有路径必须落在沙箱根目录内（canonical path 校验） */
    private File resolvePath(String path) {
        if (rootDir == null) return null;
        if (path == null || path.isEmpty()) return rootDir;

        // 统一分隔符，拒绝绝对路径中的根目录前缀
        String normalized = path.replace('\\', '/');
        while (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        File resolved = new File(rootDir, normalized.replace('/', File.separatorChar));

        try {
            String root = rootDir.getCanonicalPath();
            String real = resolved.getCanonicalPath();
            if (!real.equals(root) && !real.startsWith(root + File.separator)) {
                return null;
            }
        } catch (Exception e) {
            return null;
        }
        return resolved;
    }

    private String relativePath(File file) {
        try {
            String root = rootDir.getCanonicalPath();
            String real = file.getCanonicalPath();
            if (real.equals(root)) return "";
            return real.substring(root.length() + 1);
        } catch (Exception e) {
            return file.getName();
        }
    }

    private byte[] readAll(File file) throws Exception {
        FileInputStream in = new FileInputStream(file);
        try {
            byte[] bytes = new byte[(int) file.length()];
            int offset = 0;
            while (offset < bytes.length) {
                int read = in.read(bytes, offset, bytes.length - offset);
                if (read < 0) break;
                offset += read;
            }
            return bytes;
        } finally {
            in.close();
        }
    }

    private void writeAll(File file, byte[] bytes) throws Exception {
        FileOutputStream out = new FileOutputStream(file);
        try {
            out.write(bytes);
            out.flush();
        } finally {
            out.close();
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

    private String getDisplayName(Uri uri) {
        String result = null;
        if ("content".equalsIgnoreCase(uri.getScheme())) {
            String[] projection = {android.provider.OpenableColumns.DISPLAY_NAME};
            android.database.Cursor cursor = null;
            try {
                cursor = getContext().getContentResolver().query(uri, projection, null, null, null);
                if (cursor != null && cursor.moveToFirst()) {
                    int idx = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                    if (idx >= 0) {
                        result = cursor.getString(idx);
                    }
                }
            } catch (Exception ignored) {
            } finally {
                if (cursor != null) cursor.close();
            }
        }
        if (result == null) {
            String path = uri.getPath();
            if (path != null) {
                int cut = path.lastIndexOf('/');
                result = cut >= 0 ? path.substring(cut + 1) : path;
            }
        }
        return result;
    }
}
