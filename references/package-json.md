# Minimal package.json

Use this package file when creating a standalone workspace scraper.

```json
{
  "name": "taiji-metrics-scraper",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "scrape:all": "node scrape-taiji.mjs --all",
    "scrape": "node scrape-taiji.mjs",
    "diff:config": "node compare-config-yaml.mjs",
    "prepare:submit": "node prepare-taiji-submit.mjs",
    "submit": "node submit-taiji.mjs",
    "check": "node --check scrape-taiji.mjs && node --check compare-config-yaml.mjs && node --check prepare-taiji-submit.mjs && node --check submit-taiji.mjs"
  },
  "dependencies": {
    "cos-nodejs-sdk-v5": "^2.15.4",
    "js-yaml": "^4.1.0",
    "playwright": "^1.52.0"
  }
}
```
