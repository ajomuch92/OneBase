/** @jsxImportSource hono/jsx */

export function Shell({ children }: { children?: any }) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>OneBase Admin</title>
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          :root {
            --bg:      #0f1117;
            --surface: #1a1d27;
            --border:  #2a2d3a;
            --text:    #e2e4f0;
            --muted:   #6b7280;
            --accent:  #6366f1;
            --accent2: #818cf8;
            --green:   #10b981;
            --red:     #ef4444;
            --r:       8px;
            --font:    system-ui, -apple-system, sans-serif;
          }
          body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 14px; }
          a { color: inherit; text-decoration: none; }
          button { font-family: var(--font); cursor: pointer; }
          input, textarea, select { font-family: var(--font); }
        `}</style>
      </head>
      <body>
        <div id="app">{children}</div>
        {/* React bundle for interactive parts */}
        <script type="module" src="/admin/client.js" />
      </body>
    </html>
  )
}
