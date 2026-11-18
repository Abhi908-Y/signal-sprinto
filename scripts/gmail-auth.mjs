// One-time Gmail setup for Signal. Run it yourself in a terminal from the project folder:
//
//   node scripts/gmail-auth.mjs
//
// It asks for the OAuth Client ID and Client Secret you created in Google Cloud (a "Desktop
// app" client), opens Google's consent page, catches the reply on localhost, and saves
// GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN into .env.local.
// Nothing is printed to the screen and nothing is sent anywhere except Google.

import http from "node:http";
import fs from "node:fs";
import readline from "node:readline/promises";
import { exec } from "node:child_process";

const SCOPE = "https://www.googleapis.com/auth/gmail.send";
const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}/callback`;
const ENV_FILE = ".env.local";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const clientId = (await rl.question("Paste the OAuth Client ID: ")).trim();
const clientSecret = (await rl.question("Paste the OAuth Client Secret: ")).trim();
rl.close();

if (!clientId.endsWith(".apps.googleusercontent.com") || !clientSecret) {
  console.error("That does not look like a Google OAuth Client ID and Secret. Nothing was saved.");
  process.exit(1);
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  });

function saveEnv(values) {
  let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : `${text.replace(/\s*$/, "")}\n${line}\n`;
  }
  fs.writeFileSync(ENV_FILE, text);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", REDIRECT);
  if (url.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const finish = (status, message) => {
    res.writeHead(status, { "content-type": "text/plain; charset=utf-8" }).end(message);
    console.log(message);
    server.close();
  };

  if (error || !code) return finish(400, `Google returned an error: ${error ?? "no code"}. Nothing was saved.`);

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT,
        grant_type: "authorization_code",
      }),
    });
    const json = await tokenRes.json();
    if (!json.refresh_token) {
      return finish(500, `No refresh token came back (${json.error ?? tokenRes.status}). Nothing was saved.`);
    }
    saveEnv({
      GOOGLE_CLIENT_ID: clientId,
      GOOGLE_CLIENT_SECRET: clientSecret,
      GOOGLE_REFRESH_TOKEN: json.refresh_token,
    });
    finish(200, "Done. Gmail keys saved to .env.local. You can close this tab and go back to Claude.");
  } catch (err) {
    finish(500, `Token exchange failed: ${err instanceof Error ? err.message : err}. Nothing was saved.`);
  }
});

server.listen(PORT, () => {
  console.log("\nOpening Google's consent page in your browser...");
  console.log("If it does not open, copy this link into your browser:\n" + authUrl + "\n");
  const opener = process.platform === "win32" ? `start "" "${authUrl}"` : process.platform === "darwin" ? `open "${authUrl}"` : `xdg-open "${authUrl}"`;
  exec(opener);
});
