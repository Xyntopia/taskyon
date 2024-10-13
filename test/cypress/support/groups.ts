// list of re-usable command groups

export function selectllmmodel(provider: string, modelId: string) {
  cy.contains('Provider').click();
  cy.get('.q-menu').contains(provider).click();
  cy.wait(100)
    .contains('Select LLM Model for answering/solving the task.')
    .click()
    .type(modelId + '{enter}');
  cy.get('.q-menu').contains(modelId).click();
}

export function getLastMessage(
  selector: string = '.assistant.message',
  timeout: number = 100000,
) {
  return cy.get(`${selector} > .message-container`, { timeout }).last();
}

export function checkLastMessage(
  teststr: string,
  timeout: number = 100000,
  selector: string = '.assistant.message',
) {
  return getLastMessage(selector, timeout)
    .invoke('text')
    .then((text) => text.toLowerCase())
    .should('contain', teststr);
}

export function startNewChat() {
  cy.get('[aria-label="start new chat"]').click();
}

export function writeMessage(message: string) {
  cy.contains('your message').type(message);
}
