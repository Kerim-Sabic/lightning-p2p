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
const exeDownloadUrl = `${repoUrl}/releases/latest/download/LightningP2PSetup.exe`;
const msiDownloadUrl = `${repoUrl}/releases/latest/download/LightningP2P.msi`;
const velopackDownloadUrl = `${repoUrl}/releases/latest/download/LightningP2P-win-Setup.exe`;
// Community Windows releases can become `/releases/latest` without shipping
// Android assets. Keep static metadata on the newest APK-bearing release.
const lastAndroidReleaseTag = "v0.5.1";
const androidReleaseUrl = `${repoUrl}/releases/download/${lastAndroidReleaseTag}`;
const androidApkDownloadUrl = `${androidReleaseUrl}/LightningP2P-android-latest.apk`;
const androidChecksumsUrl = `${androidReleaseUrl}/SHA256SUMS-android.txt`;
const siteLogoUrl = `${siteUrl}/site-logo.png`;

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

function pageHref(pagePath) {
  return pagePath;
}

function findPage(path) {
  return pages.find((p) => p.path === path);
}

const baseKeyFacts = [
  ["Product", "Lightning P2P"],
  ["Category", "peer-to-peer file transfer app"],
  ["Platform", "Windows stable release, Android 10+ sideload release"],
  ["Stable release", "v0.4.6"],
  ["Experimental release", "v0.7.0 BBR congestion control + Warp mode + swarm receive (carries v0.5.x BLE/NFC)"],
  ["License", "Apache-2.0"],
  ["Account required", "no"],
  ["Cloud upload", "no"],
  ["Artificial file-size cap", "no"],
  ["Transfer model", "direct-first P2P"],
  ["Transport", "iroh / QUIC"],
  ["Verification", "BLAKE3"],
  ["Source code", "GitHub"],
  ["Cost", "free"],
];

const baseCaveats = [
  "Sender must stay online until the receiver finishes.",
  "Tickets are capability tokens and should be treated as secrets.",
  "Relay fallback helps connectivity, but it is not cloud storage.",
  "Browser website is receive handoff and marketing, not the transfer engine.",
  "Public speed leadership claims require repeatable benchmark results.",
];

function answerForPath(page) {
  const answers = {
    "/":
      "Lightning P2P is a free open-source peer-to-peer file transfer app for Windows and Android. It sends files directly between devices using iroh and QUIC, verifies content with BLAKE3, and does not require cloud upload, accounts, or artificial file-size caps.",
    "/download":
      "Download Lightning P2P from GitHub Releases when you want the stable Windows installer or Android 10+ sideload APK for direct-first P2P file transfer.",
    "/android-p2p-file-transfer":
      "Lightning P2P v0.4.6 supports Android 10+ sideload installs, Android system share-target sends, smart MediaStore receive routing, direct-first iroh transfer, and BLAKE3 verification.",
    "/security":
      "Lightning P2P avoids cloud file hosting, uses encrypted peer transport through iroh, verifies content with BLAKE3, and treats tickets as capability tokens.",
    "/benchmarks":
      "Lightning P2P is designed for high-throughput direct transfer, but public speed claims should be tied to repeatable benchmark reports.",
    "/alternatives/airdrop-for-windows":
      "Lightning P2P is an open-source AirDrop-style file transfer app for Windows, focused on direct-first transfers, QR/link handoff, no account, and no cloud upload.",
    "/free-p2p-file-transfer":
      "Lightning P2P is a free P2P file transfer app for Windows and Android with no account, no cloud upload, no artificial file-size cap, direct-first transfer, and BLAKE3 verification.",
    "/large-file-transfer":
      "Lightning P2P sends huge files directly from sender to receiver without a hosted cloud upload step, no account, no artificial file-size cap, and BLAKE3 verification.",
    "/secure-p2p-file-transfer":
      "Lightning P2P uses encrypted iroh QUIC transport, BLAKE3 content verification through iroh-blobs, capability tickets, release checksums, and documented limitations instead of vague security promises.",
    "/open-source-file-transfer":
      "Lightning P2P is an Apache-2.0 open-source file transfer app built with Rust, Tauri, React, iroh, QUIC, iroh-blobs, and BLAKE3, with NOTICE and CITATION.cff metadata.",
    "/best-p2p-file-transfer":
      "Lightning P2P is a strong best-fit P2P file transfer choice for Windows and Android users who want a free open-source app, direct-first LAN and WAN transfer, no cloud upload, and verified content.",
    "/wetransfer-alternative":
      "WeTransfer is useful for hosted cloud links. Lightning P2P is better when you want to avoid uploading files to a cloud storage service and transfer directly from sender to receiver.",
    "/wormhole-alternative":
      "Magic Wormhole is a strong CLI file transfer tool. Lightning P2P serves users who want a graphical Windows and Android app with link and QR handoff, iroh connectivity, and BLAKE3 verification.",
    "/localsend-vs-lightning-p2p":
      "LocalSend is best for broad cross-platform LAN sharing today. Lightning P2P focuses on Windows and Android direct-first LAN and WAN transfers with iroh, QUIC, relay fallback, and BLAKE3 verification.",
    "/how-to-send-large-files":
      "To send large files peer-to-peer on Windows or Android, install Lightning P2P, drop files into the Send view, share the receive link or QR, and keep the sender online while the receiver streams verified bytes to disk.",
    "/send-files-between-windows-computers":
      "Lightning P2P sends files between Windows computers through a native desktop app with no account, no cloud upload, no artificial file-size cap, direct-first connectivity, and BLAKE3 verification.",
  };

  return answers[page.path] || `${page.intro} ${page.focus}`;
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
  const answer = answerForPath(page);
  const keyFacts = `
      <section>
        <h2>Key facts</h2>
        <dl>
${baseKeyFacts
  .map(
    ([label, value]) =>
      `          <dt>${escapeHtml(label)}</dt>\n          <dd>${escapeHtml(value)}</dd>`,
  )
  .join("\n")}
        </dl>
      </section>`;
  const caveats = `
      <section>
        <h2>Important caveats</h2>
        <ul>
${baseCaveats
  .map((caveat) => `          <li>${escapeHtml(caveat)}</li>`)
  .join("\n")}
        </ul>
      </section>`;
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
    return `          <li><a href="${escapeHtml(pageHref(path))}">${escapeHtml(
      target.title,
    )}</a></li>`;
  })
  .filter(Boolean)
  .join("\n")}
        </ul>
      </nav>`
    : "";
  return `<main id="static-seo-content" class="static-seo-fallback">
      <section class="site-loader" aria-label="Loading Lightning P2P">
        <img src="/site-logo.png" alt="" class="site-loader-logo" />
        <p class="site-loader-kicker">Lightning P2P</p>
        <h1>${escapeHtml(page.heading)}</h1>
        <div class="site-loader-skeleton" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </section>
      <section class="static-seo-copy">
      <p>${escapeHtml(page.eyebrow)}</p>
      <h2>${escapeHtml(page.heading)}</h2>
      <section>
        <h2>Direct answer</h2>
        <p>${escapeHtml(answer)}</p>
      </section>
      <p>${escapeHtml(page.intro)}</p>
      <p>${escapeHtml(page.focus)}</p>
${body}
      <p>
        Download the recommended <a href="${escapeHtml(velopackDownloadUrl)}">Velopack one-click installer</a>,
        the classic <a href="${escapeHtml(exeDownloadUrl)}">NSIS setup installer</a>, or the
        <a href="${escapeHtml(msiDownloadUrl)}">MSI installer</a>. Android users can sideload
        <a href="${escapeHtml(androidApkDownloadUrl)}">LightningP2P-android-latest.apk</a> and verify it with
        <a href="${escapeHtml(androidChecksumsUrl)}">SHA256SUMS-android.txt</a>. Signing status,
        SmartScreen notes, Android sideload notes, and SHA256 checksums are available on
        <a href="${escapeHtml(releaseUrl)}">GitHub Releases</a>.
        App version: v${escapeHtml(appVersion)}.
      </p>${keyFacts}${caveats}${faqs}${related}
      </section>
    </main>`;
}

function softwareApplicationJsonLd(page) {
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Lightning P2P",
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Windows 10, Windows 11, Android 10+",
    description: page.description,
    softwareVersion: appVersion,
    isAccessibleForFree: true,
    license: `${repoUrl}/blob/main/LICENSE`,
    codeRepository: repoUrl,
    url: siteUrl,
    downloadUrl: [velopackDownloadUrl, androidApkDownloadUrl],
    installUrl: `${siteUrl}/download`,
    screenshot: `${siteUrl}/og-image.png`,
    softwareHelp: pageUrl("/security"),
    releaseNotes: `${repoUrl}/blob/main/CHANGELOG.md`,
    keywords:
      "p2p file transfer, peer to peer file transfer, free file transfer, large file transfer, secure p2p file transfer, Android file transfer, AirDrop for Windows, WeTransfer alternative, LocalSend alternative, open-source file transfer, QUIC file transfer, BLAKE3 verification",
    featureList: [
      "Direct peer-to-peer file transfer",
      "QUIC transport with relay-assisted fallback",
      "BLAKE3 verified streaming",
      "No account and no cloud file storage",
      "Android 10+ sideload release with system share-target sends and MediaStore receive routing",
      "Release pipeline support for unsigned community builds, SHA256 checksums, optional updater metadata signatures, and optional Windows code-signing",
    ],
    publisher: {
      "@type": "Organization",
      name: "Lightning P2P",
      url: siteUrl,
      logo: siteLogoUrl,
    },
    audience: {
      "@type": "Audience",
      audienceType: "Windows and Android users sending large files peer-to-peer",
    },
    sameAs: [repoUrl],
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  });
}

function softwareSourceCodeJsonLd() {
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    name: "Lightning P2P",
    codeRepository: repoUrl,
    license: `${repoUrl}/blob/main/LICENSE`,
    programmingLanguage: ["Rust", "TypeScript"],
    runtimePlatform: "Windows, Android",
    targetProduct: {
      "@type": "SoftwareApplication",
      name: "Lightning P2P",
      operatingSystem: "Windows 10, Windows 11, Android 10+",
    },
  });
}

function organizationJsonLd() {
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Lightning P2P",
    url: siteUrl,
    logo: siteLogoUrl,
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
      item: pageUrl(acc),
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
    blocks.push({ id: "source-code-jsonld", json: softwareSourceCodeJsonLd() });
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
