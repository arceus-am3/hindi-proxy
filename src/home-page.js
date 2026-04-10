function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

export function renderHomePage(origin) {
  const baseUrl = String(origin || "").replace(/\/$/, "");
  const sampleUrl = "https://example.com/master.m3u8";
  const sampleReferer = "https://desidubanime.rpmstream.live/#q5wdp";
  const endpoints = [
    `${baseUrl}/api/proxy`,
    `${baseUrl}/api/v1/proxy`,
    `${baseUrl}/api/v2/proxy`
  ];
  const exampleRequest = `${endpoints[0]}?url=${encodeURIComponent(sampleUrl)}&referer=${encodeURIComponent(sampleReferer)}`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Hindi Proxy</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f7efe4;
        --panel: rgba(255, 252, 247, 0.86);
        --panel-strong: #fffaf3;
        --text: #1f1a16;
        --muted: #6e5d50;
        --accent: #d96b2b;
        --accent-soft: #f3c7a9;
        --border: rgba(78, 48, 21, 0.14);
        --shadow: 0 24px 60px rgba(85, 49, 18, 0.12);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Trebuchet MS", "Gill Sans", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(255, 208, 163, 0.9), transparent 32%),
          radial-gradient(circle at right, rgba(244, 184, 117, 0.55), transparent 26%),
          linear-gradient(160deg, #f9f3eb 0%, #f4e1cc 100%);
        color: var(--text);
      }

      .shell {
        width: min(1080px, calc(100% - 32px));
        margin: 0 auto;
        padding: 48px 0 56px;
      }

      .hero {
        padding: 32px;
        border: 1px solid var(--border);
        border-radius: 28px;
        background: var(--panel);
        box-shadow: var(--shadow);
        backdrop-filter: blur(12px);
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 8px 14px;
        border-radius: 999px;
        background: rgba(217, 107, 43, 0.12);
        color: #9a4a1c;
        font-size: 13px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      h1 {
        margin: 18px 0 12px;
        font-size: clamp(36px, 6vw, 74px);
        line-height: 0.96;
        letter-spacing: -0.05em;
      }

      .lead {
        max-width: 760px;
        margin: 0;
        color: var(--muted);
        font-size: 18px;
        line-height: 1.6;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 18px;
        margin-top: 24px;
      }

      .card {
        border: 1px solid var(--border);
        border-radius: 22px;
        background: var(--panel-strong);
        padding: 22px;
      }

      .card h2 {
        margin: 0 0 12px;
        font-size: 18px;
      }

      .card p {
        margin: 0 0 14px;
        color: var(--muted);
        line-height: 1.55;
      }

      .code-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 12px;
      }

      code {
        display: block;
        width: 100%;
        overflow: auto;
        padding: 14px 16px;
        border-radius: 16px;
        background: #26170d;
        color: #fff4e8;
        font-family: "Courier New", monospace;
        font-size: 13px;
        line-height: 1.6;
      }

      button {
        border: 0;
        border-radius: 14px;
        padding: 12px 14px;
        background: var(--accent);
        color: white;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
      }

      button:hover {
        background: #b85118;
      }

      .pill-list {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 18px;
      }

      .pill {
        border: 1px solid rgba(217, 107, 43, 0.18);
        background: rgba(255, 255, 255, 0.45);
        color: #7f4f2b;
        padding: 10px 14px;
        border-radius: 999px;
        font-size: 14px;
        font-weight: 700;
      }

      .footer-note {
        margin-top: 18px;
        color: var(--muted);
        font-size: 14px;
      }

      @media (max-width: 640px) {
        .shell {
          width: min(100% - 20px, 1080px);
          padding-top: 20px;
          padding-bottom: 28px;
        }

        .hero,
        .card {
          padding: 18px;
          border-radius: 20px;
        }

        .code-row {
          flex-direction: column;
          align-items: stretch;
        }

        button {
          width: 100%;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <div class="eyebrow">Hindi Proxy Endpoint</div>
        <h1>Ready to proxy HLS streams.</h1>
        <p class="lead">
        Yeh homepage aapke live endpoint URLs dikhata hai. <code>url</code> query me upstream
playlist ya media URL do, aur optional <code>referer</code>, <code>audio</code>, <code>audioMode</code> bhi pass kar sakte ho.
        </p>

        <div class="pill-list">
          <div class="pill">GET</div>
          <div class="pill">HEAD</div>
          <div class="pill">POST</div>
          <div class="pill">CORS Enabled</div>
        </div>

        <div class="grid">
          <article class="card">
            <h2>Main Endpoint</h2>
            <p>Recommended endpoint for all fresh integrations.</p>
            <div class="code-row">
              <code id="endpoint-main">${escapeHtml(endpoints[0])}</code>
              <button type="button" data-copy="endpoint-main">Copy</button>
            </div>
          </article>

          <article class="card">
            <h2>Alias Endpoint v1</h2>
            <p>Backward compatibility ke liye yeh bhi same proxy par jata hai.</p>
            <div class="code-row">
              <code id="endpoint-v1">${escapeHtml(endpoints[1])}</code>
              <button type="button" data-copy="endpoint-v1">Copy</button>
            </div>
          </article>

          <article class="card">
            <h2>Alias Endpoint v2</h2>
            <p>Isko use kar sakte ho agar client already `/api/v2/proxy` hit karta hai.</p>
            <div class="code-row">
              <code id="endpoint-v2">${escapeHtml(endpoints[2])}</code>
              <button type="button" data-copy="endpoint-v2">Copy</button>
            </div>
          </article>
        </div>
      </section>

      <section class="grid">
        <article class="card">
          <h2>Example Request</h2>
          <p>Is format me endpoint hit karo.</p>
          <div class="code-row">
            <code id="example-request">${escapeHtml(exampleRequest)}</code>
            <button type="button" data-copy="example-request">Copy</button>
          </div>
        </article>

        <article class="card">
          <h2>Allowed Query Params</h2>
         <p><code>url</code> required hai. Baaki params optional hain.</p>
          <code>url=
referer=
audio=hi
audioMode=only</code>
        </article>
      </section>

      <p class="footer-note">
        Agar Cloudflare Worker par run kar rahe ho, to yeh direct edge se serve hoga aur Vercel hop remove ho jayega.
      </p>
    </main>

    <script>
      document.querySelectorAll("[data-copy]").forEach((button) => {
        button.addEventListener("click", async () => {
          const id = button.getAttribute("data-copy");
          const text = document.getElementById(id)?.textContent || "";
          try {
            await navigator.clipboard.writeText(text);
            button.textContent = "Copied";
            setTimeout(() => {
              button.textContent = "Copy";
            }, 1200);
          } catch {
            button.textContent = "Copy failed";
            setTimeout(() => {
              button.textContent = "Copy";
            }, 1200);
          }
        });
      });
    </script>
  </body>
</html>`;
}
