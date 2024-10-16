import { injectQuasarDevServerConfig } from '@quasar/quasar-app-extension-testing-e2e-cypress/cct-dev-server';
import { defineConfig } from 'cypress';

export default defineConfig({
  fixturesFolder: 'test/cypress/fixtures',
  screenshotsFolder: 'test/cypress/screenshots',
  videosFolder: 'test/cypress/videos',
  video: true,
  chromeWebSecurity: false,
  e2e: {
    // setupNodeEvents(on, config) {},
    baseUrl: 'http://localhost:9000',
    //baseUrl: 'http://localhost:4000',
    //baseUrl: 'https://taskyon.space',
    supportFile: 'test/cypress/support/e2e.ts',
    specPattern: 'test/cypress/e2e/**/*.cy.{js,jsx,ts,tsx}',
    experimentalStudio: true,
  },
  component: {
    // setupNodeEvents(on, config) {},
    supportFile: 'test/cypress/support/component.ts',
    specPattern: 'src/**/*.cy.{js,jsx,ts,tsx}',
    indexHtmlFile: 'test/cypress/support/component-index.html',
    devServer: injectQuasarDevServerConfig(),
  },
});
