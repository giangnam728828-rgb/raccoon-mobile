'use strict';

/**
 * 文件系统模块：list/read/write/delete/mkdir/rename
 * 操作目录：/Documents/Raccoon（沙箱目录）
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const ROOT = path.join(os.homedir(), 'Documents', 'Raccoon');

// 确保根目录存在
async function ensureRoot() {
  try {
    await fs.access(ROOT);
  } catch {
    await fs.mkdir(ROOT, { recursive: true });
  }
}

// 安全检查：路径必须在 ROOT 内
function checkPath(userPath) {
  const resolved = path.resolve(ROOT, userPath.replace(/^\/+/, ''));
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) {
    throw new Error('路径超出安全范围');
  }
  return resolved;
}

// 列出目录内容
async function list(dir) {
  await ensureRoot();
  const entries = [];
  try {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      let stat;
      try {
        stat = await fs.stat(path.join(dir, item.name));
      } catch {
        continue;
      }
      entries.push({
        name: item.name,
        isDir: item.isDirectory(),
        size: item.isDirectory() ? 0 : stat.size,
        modified: stat.mtimeMs,
        path: path.join(dir, item.name).replace(ROOT + path.sep, ''),
      });
    }
  } catch (e) {
    throw new Error('读取目录失败：' + e.message);
  }
  // 排序：文件夹优先，然后按名称
  entries.sort((a, b) => {
    if (a.isDir === b.isDir) return a.name.localeCompare(b.name);
    return a.isDir ? -1 : 1;
  });
  return entries;
}

// 读取文件
async function read(filePath) {
  await ensureRoot();
  const resolved = checkPath(filePath);
  try {
    const content = await fs.readFile(resolved, 'utf8');
    return content;
  } catch (e) {
    throw new Error('读取文件失败：' + e.message);
  }
}

// 写入文件
async function write(filePath, content) {
  await ensureRoot();
  const resolved = checkPath(filePath);
  const dir = path.dirname(resolved);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(resolved, content, 'utf8');
    return { path: filePath };
  } catch (e) {
    throw new Error('写入文件失败：' + e.message);
  }
}

// 删除文件或目录
async function del(filePath) {
  await ensureRoot();
  const resolved = checkPath(filePath);
  try {
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      await fs.rm(resolved, { recursive: true, force: true });
    } else {
      await fs.unlink(resolved);
    }
    return { ok: true };
  } catch (e) {
    throw new Error('删除失败：' + e.message);
  }
}

// 创建目录
async function mkdir(dirPath) {
  await ensureRoot();
  const resolved = checkPath(dirPath);
  try {
    await fs.mkdir(resolved, { recursive: true });
    return { path: dirPath };
  } catch (e) {
    throw new Error('创建目录失败：' + e.message);
  }
}

// 重命名
async function rename(fromPath, toPath) {
  await ensureRoot();
  const from = checkPath(fromPath);
  const to = checkPath(toPath);
  try {
    await fs.rename(from, to);
    return { path: toPath };
  } catch (e) {
    throw new Error('重命名失败：' + e.message);
  }
}

module.exports = { list, read, write, del, mkdir, rename, ROOT };
