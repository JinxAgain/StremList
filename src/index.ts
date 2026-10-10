import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApp();

app.listen(config.port, () => {
  console.log(`===============================================`);
  console.log(`⚡ StremList Addon Server is running!`);
  console.log(`📡 Local Addon URL: http://127.0.0.1:${config.port}/manifest.json`);
  console.log(`🛠️  Configure Web UI: http://127.0.0.1:${config.port}/configure`);
  console.log(`📁 Default Target Drive: ${config.defaultDrive.toUpperCase()}`);
  console.log(`🌐 OpenList Server: ${config.openlistUrl}`);
  console.log(`===============================================`);
});
