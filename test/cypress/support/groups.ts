// list of re-usable command groups

export const testModelId = 'google/gemini-2.5-flash-lite'

const modelSelectLabel = 'Select LLM Model for answering/solving the task.'
const modelPopupSelector = '.model-select-popup:visible'

function isQuasarToggleOn($toggle: JQuery<HTMLElement>) {
  return $toggle.hasClass('q-toggle--truthy') || $toggle.attr('aria-checked') === 'true'
}

function getSettingsToggle(label: string) {
  return cy
    .get('[data-cy="ai-settings"]:visible')
    .find(`[data-cy="${label}"]:visible .q-toggle:visible`)
    .first()
}

export function setSettingsToggle(label: string, enabled: boolean) {
  getSettingsToggle(label)
    .should('exist')
    .then(($toggle) => {
      if (isQuasarToggleOn($toggle) !== enabled) {
        cy.wrap($toggle).click()
      }
    })

  getSettingsToggle(label).should(($toggle) => {
    expect(isQuasarToggleOn($toggle)).to.equal(enabled)
  })
}

export function closeAiSettings() {
  cy.get('[data-cy="ai-settings"]:visible').should('exist')
  cy.get('body').type('{esc}')
  cy.get('[data-cy="ai-settings"]:visible').should('not.exist')
}

function getModelField() {
  return cy.dataCy('model-selection').contains('.q-field', modelSelectLabel)
}

function clickModelField() {
  getModelField().scrollIntoView().should('be.visible').click('center')
}

function pressModelFieldOpenKey() {
  getModelField().find('input').focus().type('{downArrow}', { force: true })
}

function openModelPopup(attempt = 0): Cypress.Chainable<JQuery<HTMLElement>> {
  clickModelField()
  pressModelFieldOpenKey()

  return cy.get('body').then(($body) => {
    if ($body.find(modelPopupSelector).length > 0) {
      return cy.get(modelPopupSelector)
    }
    if (attempt >= 8) {
      return cy.get(modelPopupSelector, { timeout: 10000 })
    }
    cy.wait(250)
    return openModelPopup(attempt + 1)
  })
}

export function selectllmmodel(provider?: string, modelId = '') {
  cy.dataCy('model-id').click() // open the menu

  cy.dataCy('model-selection').should('be.visible')

  if (provider) {
    cy.dataCy('model-selection').contains('.q-field', 'Provider').click()

    cy.get('.q-menu:visible')
      .last()
      .find('[data-cy="provider-option"]')
      .filter((_, el) => el.getAttribute('data-provider') === provider)
      .first()
      .click()

    cy.dataCy('provider-select').should('contain.text', provider)
  }

  if (modelId) {
    clickModelField()
    getModelField().find('input').should('be.visible').clear().type(modelId)

    openModelPopup()
      .find('[data-cy="model-option"]')
      .filter((_, el) => el.getAttribute('data-model-id') === modelId)
      .first()
      .click()

    cy.dataCy('model-select').should('have.value', modelId)
  }

  cy.dataCy('model-selection').type('{esc}')
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
  cyc2.get('.create-tasks textarea', { timeout: 10000 }).type(msg)
  cyc2.get('.create-tasks textarea').type('{enter}')
}

export function addAIServices() {
  cy.get('#ty-space-menu').click()
  cy.dataCy('open-settings').click()
  cy.dataCy('aiserviceprovider').click()

  //cy.get('.q-btn').contains('AI service provider se', { matchCase: false }).click()
  cy.contains('Add API keys').click()
  // check in our keepass to get the relevant json.
  cy.contains('openai').click()
  cy.dataCy('add-openai').type(Cypress.env().openai_api_key + '{enter}')
  cy.contains('openrouter.ai').click()
  cy.dataCy('add-openrouter.ai').type(Cypress.env().openrouter_api_key + '{enter}')
}
