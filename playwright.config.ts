import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'tests', testMatch:'visual.spec.ts', timeout:45_000, use:{baseURL:'http://127.0.0.1:4321'},
  webServer:[
    {command:'node scripts/fixture-api.mjs',url:'http://127.0.0.1:8787/health',reuseExistingServer:true,timeout:20_000},
    {command:'pnpm --dir apps/web dev --host 127.0.0.1 --port 4321',url:'http://127.0.0.1:4321',reuseExistingServer:true,timeout:40_000,env:{PUBLIC_API_ORIGIN:'http://127.0.0.1:8787'}}
  ], projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}]
});
