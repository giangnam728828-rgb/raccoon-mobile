'use strict';

/**
 * Git 操作模块
 */

const { exec } = require('child_process');
const path = require('path');
const util = require('util');
const execAsync = util.promisify(exec);

const ROOT = path.join(process.env.HOME || os.homedir(), 'Documents', 'Raccoon');

// 执行 git 命令（在指定目录）
async function gitRun(cwd, args) {
  try {
    const { stdout, stderr } = await execAsync(`git ${args}`, { cwd, maxBuffer: 1024 * 1024 });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (e) {
    // git 命令失败会抛错，但可能有输出
    return {
      ok: false,
      stdout: e.stdout ? e.stdout.toString().trim() : '',
      stderr: e.stderr ? e.stderr.toString().trim() : e.message,
    };
  }
}

// 初始化仓库
async function initRepo(cwd) {
  try {
    await gitRun(cwd, 'init');
    return { ok: true, message: '已初始化' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// 获取状态
async function status(cwd) {
  const staged = [];
  const unstaged = [];
  const untracked = [];
  
  try {
    const res = await gitRun(cwd, 'status --porcelain');
    if (!res.ok && !res.stdout) return { branch: null, remote: null, log: [], staged: [], unstaged: [], untracked: [] };
    
    for (const line of res.stdout.split('\n')) {
      if (!line) continue;
      const file = line.slice(3);
      if (line.startsWith('??')) {
        untracked.push(file);
      } else if (line[0] === ' ') {
        unstaged.push(file);
      } else {
        staged.push(file);
      }
    }
  } catch {}
  
  // 分支信息
  let branch = 'main';
  try {
    const res = await gitRun(cwd, 'branch --show-current');
    if (res.ok && res.stdout) branch = res.stdout.trim();
  } catch {}
  
  // 远程
  let remote = '未配置';
  try {
    const res = await gitRun(cwd, 'remote -v');
    if (res.ok && res.stdout) {
      const lines = res.stdout.trim().split('\n');
      if (lines.length > 0) remote = lines[0].split('\t')[0];
    }
  } catch {}
  
  // 最近提交日志
  const log = [];
  try {
    const res = await gitRun(cwd, 'log --oneline -10');
    if (res.ok && res.stdout) {
      for (const line of res.stdout.trim().split('\n')) {
        const match = /^([a-f0-9]{7}) (.+)/.exec(line);
        if (match) {
          log.push({ hash: match[1], message: match[2], timestamp: Date.now() });
        }
      }
    }
  } catch {}
  
  return { branch, remote, log, staged, unstaged, untracked };
}

// 拉取
async function pull(cwd) {
  const res = await gitRun(cwd, 'pull');
  return res.ok ? { ok: true, message: '拉取成功' } : { ok: false, message: res.stderr };
}

// 推送
async function push(cwd) {
  const res = await gitRun(cwd, 'push');
  return res.ok ? { ok: true, message: '推送成功' } : { ok: false, message: res.stderr };
}

module.exports = { initRepo, status, pull, push, ROOT };
