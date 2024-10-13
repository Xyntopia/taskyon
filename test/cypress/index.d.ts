/// <reference types="cypress" />

declare namespace Cypress {
  interface Chainable {
    selectllmmodel(provider: string, modelId: string): void;
  }
}
