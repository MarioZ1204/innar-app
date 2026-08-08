const path = require('path');
const { resolvePuppeteerCacheDir } = require('../config/puppeteer-cache-path');

describe('puppeteer-cache-path', () => {
  const prevUploads = process.env.UPLOADS_DIR;
  const prevCache = process.env.PUPPETEER_CACHE_DIR;

  afterEach(() => {
    if (prevUploads === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = prevUploads;
    if (prevCache === undefined) delete process.env.PUPPETEER_CACHE_DIR;
    else process.env.PUPPETEER_CACHE_DIR = prevCache;
  });

  test('usa PUPPETEER_CACHE_DIR si está definido', () => {
    process.env.PUPPETEER_CACHE_DIR = '/tmp/custom_puppeteer';
    expect(resolvePuppeteerCacheDir()).toBe(path.resolve('/tmp/custom_puppeteer'));
  });

  test('deriva private_puppeteer junto a UPLOADS_DIR', () => {
    delete process.env.PUPPETEER_CACHE_DIR;
    process.env.UPLOADS_DIR = '/home/user/domains/site.com/private_uploads';
    expect(resolvePuppeteerCacheDir()).toBe(
      path.resolve('/home/user/domains/site.com/private_puppeteer')
    );
  });
});
