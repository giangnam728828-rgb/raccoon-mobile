'use strict';

/**
 * 运行配置：环境变量集中在这里解析，其余模块只读这个对象。
 */

const path = require('path');

const ROOT = path.join(__dirname, '..');

function int(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

const UPSTREAM = (process.env.UPSTREAM || 'https://xiaohuanxiong.com').replace(/\/+$/, '');

module.exports = {
  ROOT,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  DATA_DIR: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data'),

  UPSTREAM,
  PORT: int(process.env.PORT, 8799),
  HOST: process.env.HOST || '127.0.0.1',
  ACCESS_KEY: (process.env.ACCESS_KEY || '').trim(),

  // 上限
  MAX_BODY: int(process.env.MAX_BODY, 8 * 1024 * 1024),
  MAX_SYNC_BYTES: int(process.env.MAX_SYNC_BYTES, 4 * 1024 * 1024),

  // 官方客户端标识（与网页端一致）
  CLIENT_NAME: 'raccoon-ai',
  CLIENT_VERSION: '1.0.35',
  WEB_CLIENT_VERSION: 'v1.1.3',
  MOBILE_PLATFORM: 'app-android',
  MOBILE_CLIENT_VERSION: 'v1.0.3',
  OS_VERSION: '10.0.26200',
  CHANNEL: 'stable',

  // 手机号加密密钥（官方网页端）
  PHONE_CIPHER_KEY: 'senseraccoon2023',

  CAPTCHA: {
    scene: process.env.CAPTCHA_SCENE || '1pkmy0x3',
    prefix: process.env.CAPTCHA_PREFIX || 'hk1r5l',
    region: process.env.CAPTCHA_REGION || 'cn',
  },

  NATION_CODES: [
    { code: '+86', label: '中国大陆' },
    { code: '+852', label: '中国香港' },
    { code: '+853', label: '中国澳门' },
    { code: '+886', label: '中国台湾' },
  ],
};
