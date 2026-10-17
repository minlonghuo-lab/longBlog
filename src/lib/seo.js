import { getPostPath } from './routes.js';

/** Build article metadata from the same data used to render the visible page. */
export function createArticleSchema(post, site, author, siteTitle) {
  const url = new URL(getPostPath(post.id), site).href;
  const source = post.contentHtml.match(/<img\b[^>]*\ssrc=["']([^"']+)["']/i)?.[1];
  let image;
  if (source) {
    try {
      const candidate = new URL(source.replaceAll('&amp;', '&'), site);
      if (['https:', 'http:'].includes(candidate.protocol)) image = [candidate.href];
    } catch { /* An invalid article image must not break the site's build. */ }
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    '@id': `${url}#article`,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    headline: post.title,
    description: post.summary || post.title,
    datePublished: post.publishedAt.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    author: { '@type': 'Person', name: author, url: new URL('about/', site).href },
    isPartOf: { '@type': 'WebSite', name: siteTitle, url: new URL('/', site).href },
    inLanguage: 'zh-CN',
    keywords: post.tags,
    ...(image ? { image } : {}),
  };
}

/** Prevent note text from closing an inline JSON-LD script element. */
export function serializeJsonLd(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
