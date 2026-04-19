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
const repoUrl = "https://github.com/Kerim-Sabic/lightning-p2p";
const releaseUrl = `${repoUrl}/releases/latest`;
const exeDownloadUrl = `${repoUrl}/releases/latest/download/Lightning.P2P_${appVersion}_x64-setup.exe`;
const msiDownloadUrl = `${repoUrl}/releases/latest/download/Lightning.P2P_${appVersion}_x64_en-US.msi`;
const velopackDownloadUrl = `${repoUrl}/releases/latest/download/LightningP2P-win-Setup.exe`;

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

function findPage(path) {
  return pages.find((p) => p.path === path);
}

function replaceTag(html, pattern, replacement) {
  if (!pattern.test(html)) {
    throw new Error(`Missing metadata pattern: ${pattern}`);
  }

  return html.replace(pattern, replacement);
}

function jsonLd(object) {
  return JSON.stringify(object, null, 2);
}

function staticSeoContent(page) {
  const body = Array.isArray(page.body)
    ? page.body
        .map((paragraph) => `      <p>${escapeHtml(paragraph)}</p>`)
        .join("\n")
    : "";
  const faqs = Array.isArray(page.faqs)
    ? `
      <section>
        <h2>Frequently asked questions</h2>
        <dl>
${page.faqs
  .map(
    (faq) =>
      `          <dt>${escapeHtml(faq.q)}</dt>\n          <dd>${escapeHtml(
        faq.a,
      )}</dd>`,
  )
  .join("\n")}
        </dl>
      </section>`
    : "";
  const related = Array.isArray(page.related)
    ? `
      <nav aria-label="Related pages">
        <h2>Related</h2>
        <ul>
${page.related
  .map((path) => {
    const target = findPage(path);
    if (!target) {
      return "";
    }
    return `          <li><a href="${escapeHtml(path)}">${escapeHtml(
      target.label,
    )} - ${escapeHtml(target.title)}</a></li>`;
  })
  .filter(Boolean)
  .join("\n")}
        </ul>
      </nav>`
    : "";
  return `<main id="static-seo-content" class="static-seo-fallback">
      <p>${escapeHtml(page.eyebrow)}</p>
      <h1>${escapeHtml(page.heading)}</h1>
      <p>${escapeHtml(page.intro)}</p>
      <p>${escapeHtml(page.focus)}</p>
${body}
      <p>
        Download the Windows <a href="${escapeHtml(exeDownloadUrl)}">EXE setup installer</a>,
        <a href="${escapeHtml(velopackDownloadUrl)}">Velopack one-click installer</a>, or
        <a href="${escapeHtml(msiDownloadUrl)}">MSI installer</a>. Release checksums and signatures
        are available on <a href="${escapeHtml(releaseUrl)}">GitHub Releases</a>.
      </p>${faqs}${related}
    </main>`;
}

function softwareApplicationJsonLd(page) {
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Lightning P2P",
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Windows 10, Windows 11",
    description: page.description,
    softwareVersion: appVersion,
    isAccessibleForFree: true,
    license: `${repoUrl}/blob/main/LICENSE`,
    codeRepository: repoUrl,
    url: siteUrl,
    downloadUrl: exeDownloadUrl,
    sameAs: [repoUrl],
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  });
}

function organizationJsonLd() {
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Lightning P2P",
    url: siteUrl,
    logo: `${siteUrl}/og-image.png`,
    sameAs: [repoUrl],
  });
}

function faqPageJsonLd(page) {
  if (!Array.isArray(page.faqs) || page.faqs.length === 0) {
    return null;
  }
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.a,
      },
    })),
  });
}

function howToJsonLd(page) {
  if (!page.howTo) {
    return null;
  }
  const { name, totalTime, steps } = page.howTo;
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "HowTo",
    name,
    totalTime,
    step: steps.map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: step.name,
      text: step.text,
      ...(step.url ? { url: step.url } : {}),
    })),
  });
}

function breadcrumbJsonLd(page) {
  if (page.path === "/") {
    return null;
  }
  const segments = page.path.split("/").filter(Boolean);
  const items = [
    {
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: `${siteUrl}/`,
    },
  ];
  let acc = "";
  segments.forEach((segment, index) => {
    acc += `/${segment}`;
    const match = findPage(acc);
    items.push({
      "@type": "ListItem",
      position: index + 2,
      name: match?.label || segment,
      item: `${siteUrl}${acc}`,
    });
  });
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items,
  });
}

function websiteJsonLd() {
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Lightning P2P",
    url: `${siteUrl}/`,
    publisher: {
      "@type": "Organization",
      name: "Lightning P2P",
      url: siteUrl,
    },
  });
}

function buildAdditionalJsonLd(page) {
  const blocks = [];
  if (page.path === "/") {
    blocks.push({ id: "website-jsonld", json: websiteJsonLd() });
    blocks.push({ id: "organization-jsonld", json: organizationJsonLd() });
  }
  const breadcrumb = breadcrumbJsonLd(page);
  if (breadcrumb) {
    blocks.push({ id: "breadcrumb-jsonld", json: breadcrumb });
  }
  const faq = faqPageJsonLd(page);
  if (faq) {
    blocks.push({ id: "faq-jsonld", json: faq });
  }
  const howTo = howToJsonLd(page);
  if (howTo) {
    blocks.push({ id: "howto-jsonld", json: howTo });
  }
  if (blocks.length === 0) {
    return "";
  }
  return blocks
    .map(
      (block) =>
        `\n    <script type="application/ld+json" id="${block.id}">${block.json}</script>`,
    )
    .join("");
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
  const additionalLd = buildAdditionalJsonLd(page);
  html = replaceTag(
    html,
    /<script\s+type="application\/ld\+json"\s+id="software-application-jsonld">[\s\S]*?<\/script>/su,
    `<script type="application/ld+json" id="software-application-jsonld">${softwareApplicationJsonLd(
      page,
    )}</script>${additionalLd}`,
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
    <priority>${page.priority ?? (page.path === "/" ? "1.0" : "0.8")}</priority>
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
