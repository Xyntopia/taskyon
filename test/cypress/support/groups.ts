// list of re-usable command groups

export const testModelId = 'google/gemini-2.5-flash-lite'

export function selectllmmodel(provider: string | undefined, modelId: string = '') {
  cy.dataCy('model-id').click() // open the menu
  if (provider) {
    cy.dataCy('model-selection').contains('Provider').click()
    cy.dataCy('model-selection').get('.q-menu').contains(provider).click()
  }
  if (modelId) {
    cy.wait(100)
      .contains('Select LLM Model for answering/solving the task.')
      .click()
      .type(modelId)
      .wait(200)
    cy.get('.q-menu').contains(modelId).click()
  }
  // close the menu
  cy.dataCy('model-selection').type('{esc}')

  //.type('{enter}{esc}');
  //cy.get('.q-menu').contains(modelId).click();
}

export function getLastAssistantMessage(
  selector: string = '.assistant.message',
  timeout: number = 100000,
) {
  return cy.get(`${selector} .ty-markdown`, { timeout }).last()
}

export function checkLastMessage(
  teststr: string,
  timeout: number = 100000,
  selector: string = '.assistant.message',
) {
  return getLastAssistantMessage(selector, timeout)
    .invoke('text')
    .then((text) => text.toLowerCase())
    .should('contain', teststr)
}

export function startNewChat() {
  cy.get('[aria-label="start new chat"]').click()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function writeMessage(msg: string, cyc: Cypress.Chainable<any> | undefined = undefined) {
  const cyc2 = cyc ?? cy
  cyc2.get('.create-tasks textarea').type(msg)
  cyc2.get('.create-tasks textarea').type('{enter}')
}

export function addAIServices() {
  cy.get('#ty-space-menu').click()
  cy.dataCy('open-settings').click()
  cy.dataCy('aiserviceprovider').click()

  //cy.get('.q-btn').contains('AI service provider se', { matchCase: false }).click()
  cy.contains('Add API keys').click()
  // check in our keepass to get the relevant json.
  cy.contains('openai API key').type(Cypress.env().openai_api_key)
  cy.contains('openrouter.ai API key').type(Cypress.env().openrouter_api_key)
}

export function useFreeTaskyon() {
  cy.get('.q-btn').contains('AI service provider se', { matchCase: false }).click()
  cy.get('.q-btn').contains('Use free Taskyon', { matchCase: false }).click()
}
