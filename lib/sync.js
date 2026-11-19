'use strict';

/**
 * 对话云同步：把本地对话按账号存到服务端，换手机或重装后可恢复。
 *
 * 存储是按账号隔离的单个 JSON 文件，不做关系型建模 —— 对话是整体读取、
 * 整体覆盖的使用模式，这样最简单也最不容易出现半写坏的状态。
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const util = require('./util');

const DIR = path.join(config.DATA_DIR, 'sync');

function fileFor(accountKey) {
  const h = util.sha256Hex('sync:' + (accountKey || 'anon')).slice(0, 32);
  return path.join(DIR, h + '.json');
}

function ensureDir() {
  try {
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  } catch (e) {
    console.warn('[sync] 目录创建失败:', e.message);
  }
}

/**
 * 读取某账号的同步数据。
 * @returns {{rev:number, updatedAt:number, chats:Array}|null}
 */
function read(accountKey) {
  try {
    const f = fileFor(accountKey);
    if (!fs.existsSync(f)) return null;
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!raw || !Array.isArray(raw.chats)) return null;
    return {
      rev: Number(raw.rev) || 0,
      updatedAt: Number(raw.updatedAt) || 0,
      chats: raw.chats,
    };
  } catch {
    return null;
  }
}

/**
 * 整体覆盖写入。
 * @returns {{rev:number, updatedAt:number, count:number}}
 */
function write(accountKey, chats) {
  ensureDir();
  const prev = read(accountKey);
  const rev = (prev ? prev.rev : 0) + 1;
  const payload = {
    rev,
    updatedAt: Date.now(),
    chats: Array.isArray(chats) ? chats : [],
  };
  const f = fileFor(accountKey);
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 });
  fs.renameSync(tmp, f); // 原子替换，避免半写
  return { rev, updatedAt: payload.updatedAt, count: payload.chats.length };
}

function remove(accountKey) {
  try {
    const f = fileFor(accountKey);
    if (fs.existsSync(f)) fs.unlinkSync(f);
    return true;
  } catch {
    return false;
  }
}

function bytesFor(accountKey) {
  try {
    const f = fileFor(accountKey);
    if (!fs.existsSync(f)) return 0;
    return fs.statSync(f).size;
  } catch {
    return 0;
  }
}

module.exports = { read, write, remove, bytesFor };
