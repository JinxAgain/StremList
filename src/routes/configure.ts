import { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import fs from 'fs';
import { loadConfig } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIGURE_HTML_PATH = path.resolve(__dirname, '../public/configure.html');

export function handleConfigure(_req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  try {
    const config = loadConfig();
    let html = fs.readFileSync(CONFIGURE_HTML_PATH, 'utf-8');

    // Pre-populate input fields with server config
    html = html.replace('value="http://127.0.0.1:5244"', `value="${config.openlistUrl}"`);
    if (config.openlistToken) {
      html = html.replace('id="openlistToken"', `id="openlistToken" value="${config.openlistToken}"`);
    }
    if (config.defaultDrive.toLowerCase() === 'pikpak') {
      html = html.replace('<option value="115" selected>', '<option value="115">');
      html = html.replace('<option value="pikpak">', '<option value="pikpak" selected>');
    }
    if (config.torrentioUrl) {
      html = html.replace('value="https://torrentio.strem.fun"', `value="${config.torrentioUrl}"`);
    }
    if (config.cometUrl) {
      html = html.replace('value="https://comet.elfhosted.com"', `value="${config.cometUrl}"`);
    }

    return res.send(html);
  } catch {
    return res.sendFile(CONFIGURE_HTML_PATH);
  }
}
