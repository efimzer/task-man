import { Router } from 'express';

const MAX_HTML_BYTES = 220000;
const FETCH_TIMEOUT_MS = 5000;

function isIpv4(hostname) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname);
}

function isPrivateIpv4(hostname) {
  if (!isIpv4(hostname)) {
    return false;
  }
  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  return false;
}

function isPrivateHostname(hostname) {
  if (!hostname) {
    return true;
  }
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }
  if (host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }
  if (isPrivateIpv4(host)) {
    return true;
  }
  if (host.includes(':')) {
    if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
      return true;
    }
  }
  return false;
}

function normalizeRequestUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    if (isPrivateHostname(parsed.hostname)) {
      return null;
    }
    return parsed;
  } catch (error) {
    return null;
  }
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'GoFimaGo/1.0',
        Accept: 'text/html,application/xhtml+xml'
      }
    });
    if (!response.ok) {
      return null;
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return null;
    }
    const reader = response.body?.getReader?.();
    if (!reader) {
      return await response.text();
    }
    const decoder = new TextDecoder('utf-8');
    let html = '';
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        received += value.length;
        if (received > MAX_HTML_BYTES) {
          html += decoder.decode(value, { stream: true });
          break;
        }
        html += decoder.decode(value, { stream: true });
      }
    }
    return html;
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function decodeHtml(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function findMetaContent(html, key) {
  if (!html || !key) {
    return '';
  }
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const metaPattern = new RegExp(`<meta[^>]+(?:name|property)=['"]${escaped}['"][^>]*>`, 'i');
  const match = html.match(metaPattern);
  if (!match) {
    return '';
  }
  const tag = match[0];
  const contentMatch = tag.match(/content=['"]([^'"]+)['"]/i);
  return contentMatch ? decodeHtml(contentMatch[1]) : '';
}

function findTitle(html) {
  if (!html) {
    return '';
  }
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch ? decodeHtml(titleMatch[1]) : '';
}

function normalizeText(value, limit) {
  if (!value) {
    return '';
  }
  const trimmed = decodeHtml(value);
  if (!limit || trimmed.length <= limit) {
    return trimmed;
  }
  return trimmed.slice(0, limit).trim();
}

function resolveUrl(value, baseUrl) {
  if (!value) {
    return '';
  }
  try {
    return new URL(value, baseUrl).toString();
  } catch (error) {
    return '';
  }
}

function buildPreviewData(html, targetUrl) {
  const ogTitle = findMetaContent(html, 'og:title');
  const twitterTitle = findMetaContent(html, 'twitter:title');
  const title = normalizeText(ogTitle || twitterTitle || findTitle(html), 140);

  const ogDescription = findMetaContent(html, 'og:description');
  const twitterDescription = findMetaContent(html, 'twitter:description');
  const description = normalizeText(ogDescription || twitterDescription || findMetaContent(html, 'description'), 220);

  const ogImage = findMetaContent(html, 'og:image');
  const ogImageSecure = findMetaContent(html, 'og:image:secure_url');
  const twitterImage = findMetaContent(html, 'twitter:image');
  const image = resolveUrl(ogImageSecure || ogImage || twitterImage, targetUrl);

  const siteName = normalizeText(findMetaContent(html, 'og:site_name'), 80);

  return {
    title,
    description,
    image,
    siteName
  };
}

export function createPreviewRouter({ authHelpers }) {
  const router = Router();

  router.get('/preview', authHelpers.requireAuth, async (req, res) => {
    const urlParam = req.query?.url;
    const parsed = normalizeRequestUrl(urlParam);
    if (!parsed) {
      res.status(400).json({ error: 'INVALID_URL' });
      return;
    }

    const html = await fetchHtml(parsed.toString());
    if (!html) {
      res.status(200).json({ ok: true, data: {} });
      return;
    }

    const data = buildPreviewData(html, parsed.toString());
    res.json({ ok: true, data });
  });

  return router;
}
