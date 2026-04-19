#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const distDir = join(repoRoot, "dist");
const siteUrl = (process.env.SITE_URL || "https://lightning-p2p.netlify.app").replace(
  /\/$/u,
  "",
);

const pages = JSON.parse(
  await readFile(join(repoRoot, "src", "content", "web-pages.json"), "utf8"),
);
const packageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
const appVersion = packageJson.version;
const releaseUrl = "https://github.com/Kerim-Sabic/lightning-p2p/releases/latest";
const exeDownloadUrl = `https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/Lightning.P2P_${appVersion}_x64-setup.exe`;
const msiDownloadUrl = `https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/Lightning.P2P_${appVersion}_x64_en-US.msi`;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeXml(value) {
  return escapeHtml(value).replaceAll("'", "&apos;");
}

function pageUrl(pagePath) {
  return pagePath === "/" ? `${siteUrl}/` : `${siteUrl}${pagePath}`;
}

function replaceTag(html, pattern, replacement) {
  if (!pattern.test(html)) {
    throw new Error(`Missing metadata pattern: ${pattern}`);
  }

  return html.replace(pattern, replacement);
}

function staticSeoContent(page) {
  return `<main id="static-seo-content" class="static-seo-fallback">
      <p>${escapeHtml(page.eyebrow)}</p>
      <h1>${escapeHtml(page.heading)}</h1>
      <p>${escapeHtml(page.intro)}</p>
      <p>${escapeHtml(page.focus)}</p>
      <p>
        Download the Windows <a href="${escapeHtml(exeDownloadUrl)}">EXE setup installer</a>
        or <a href="${escapeHtml(msiDownloadUrl)}">MSI installer</a>. Release checksums and
        signatures are available on <a href="${escapeHtml(releaseUrl)}">GitHub Releases</a>.
      </p>
    </main>`;
}

function softwareApplicationJsonLd(page) {
  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Lightning P2P",
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Windows 10, Windows 11",
      description: page.description,
      softwareVersion: appVersion,
      isAccessibleForFree: true,
      license: "https://github.com/Kerim-Sabic/lightning-p2p/blob/main/LICENSE",
      codeRepository: "https://github.com/Kerim-Sabic/lightning-p2p",
      url: siteUrl,
      downloadUrl: exeDownloadUrl,
      sameAs: ["https://github.com/Kerim-Sabic/lightning-p2p"],
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    },
    null,
    2,
  );
}

function metadataHtml(baseHtml, page) {
  const url = pageUrl(page.path);
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description);
  const imageUrl = `${siteUrl}/og-image.png`;

  let html = baseHtml;
  html = replaceTag(html, /<title>.*?<\/title>/su, `<title>${title}</title>`);
  html = replaceTag(
    html,
    /<meta\s+name="description"\s+content="[^"]*"\s*\/>/su,
    `<meta name="description" content="${description}" />`,
  );
  html = replaceTag(
    html,
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/>/su,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
  );
  html = replaceTag(
    html,
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/>/su,
    `<meta property="og:title" content="${title}" />`,
  );
  html = replaceTag(
    html,
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/>/su,
    `<meta property="og:description" content="${description}" />`,
  );
  html = replaceTag(
    html,
    /<meta\s+property="og:url"\s+content="[^"]*"\s*\/>/su,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
  );
  html = replaceTag(
    html,
    /<meta\s+property="og:image"\s+content="[^"]*"\s*\/>/su,
    `<meta property="og:image" content="${escapeHtml(imageUrl)}" />`,
  );
  html = replaceTag(
    html,
    /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/>/su,
    `<meta name="twitter:title" content="${title}" />`,
  );
  html = replaceTag(
    html,
    /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/>/su,
    `<meta name="twitter:description" content="${description}" />`,
  );
  html = replaceTag(
    html,
    /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/>/su,
    `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />`,
  );
  html = replaceTag(
    html,
    /<script\s+type="application\/ld\+json"\s+id="software-application-jsonld">[\s\S]*?<\/script>/su,
    `<script type="application/ld+json" id="software-application-jsonld">${softwareApplicationJsonLd(
      page,
    )}</script>`,
  );
  html = replaceTag(
    html,
    /<main\s+id="static-seo-content"\s+class="static-seo-fallback">[\s\S]*?<\/main>/su,
    staticSeoContent(page),
  );

  return html;
}

const baseHtml = await readFile(join(distDir, "index.html"), "utf8");

for (const page of pages) {
  const html = metadataHtml(baseHtml, page);
  const outputDir = page.path === "/" ? distDir : join(distDir, page.path.slice(1));
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "index.html"), html, "utf8");
}

const lastmod = new Date().toISOString().slice(0, 10);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
  .map(
    (page) => `  <url>
    <loc>${escapeXml(pageUrl(page.path))}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${page.path === "/" ? "1.0" : "0.8"}</priority>
  </url>`,
  )
  .join("\n")}
</urlset>
`;

const robots = `User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`;

await writeFile(join(distDir, "sitemap.xml"), sitemap, "utf8");
await writeFile(join(distDir, "robots.txt"), robots, "utf8");

console.log(`Generated SEO route metadata for ${pages.length} pages at ${siteUrl}`);
